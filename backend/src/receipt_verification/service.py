"""Automatic OFD verification of QR-intake receipts with a full attempt history.

One attempt = claim the receipt (short transaction, lease on ``next_verification_at``
so the cron and an admin never run it twice at once) → ONE provider call outside any
transaction → record the attempt and the resulting state (second short transaction).

State (``receipt.verification_status``), independent of the moderation status:
``pending`` → (ok) ``verified`` | (else) ``retrying`` → … → ``failed`` after
``len(RETRY_DELAYS)`` retries. The cron only retries receipts still awaiting a
moderation decision: once an admin decided, manual review wins and retries stop.
An admin can always force an extra attempt (trigger ``admin``).
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.fraud.checks import FraudChecker
from src.receipt.models import (
    Receipt,
    ReceiptStatus,
    ReceiptVerificationAttempt,
    VerificationOutcome,
    VerificationStatus,
)
from src.receipt_intake.fiscal import FiscalData, FiscalValidationError, parse_qr
from src.receipt_verification.verifier import VerificationResult, Verifier

logger = logging.getLogger(__name__)

# Delay before retry #k (after the k-th failed attempt). 8 retries ≈ 4 days in total.
RETRY_DELAYS: tuple[timedelta, ...] = (
    timedelta(minutes=5),
    timedelta(minutes=15),
    timedelta(hours=1),
    timedelta(hours=3),
    timedelta(hours=6),
    timedelta(hours=12),
    timedelta(hours=24),
    timedelta(hours=48),
)
# While an attempt is in flight the receipt is leased (verification_locked_until):
# nobody else may start an attempt. A crashed attempt frees itself after the lease.
ATTEMPT_LEASE = timedelta(minutes=10)
# Provider-side refusals (request limit, token blocked) are not the receipt's fault:
# they do not spend the retry budget — retry after a pause instead.
PROVIDER_PAUSE = timedelta(hours=1)
_PROVIDER_SIDE = (VerificationOutcome.rate_limited, VerificationOutcome.blocked)
# The cron runs under arq's job timeout: stop taking new receipts after this budget.
CRON_BATCH = 25
CRON_TIME_BUDGET_S = 90.0
SUM_TOLERANCE = 0.01  # same 1 % as the legacy pipeline

_ACTIVE = (VerificationStatus.pending.value, VerificationStatus.retrying.value)
# Literal (not bound) so the planner can match the partial index ix_receipt_verification_due.
_ACTIVE_SQL = text("vliq.receipt.verification_status IN ('pending', 'retrying')")


def method_for_attempt(methods: tuple[str, ...], attempt_no: int) -> str:
    return methods[(attempt_no - 1) % len(methods)]


def next_state(failures: int, outcome: VerificationOutcome, now: datetime) -> tuple[str, datetime | None]:
    """(verification_status, next_verification_at) after an attempt.

    ``failures`` — budget-counting failures INCLUDING this attempt (unchanged for
    provider-side outcomes, which pause instead of spending the budget).
    """
    if outcome is VerificationOutcome.ok:
        return VerificationStatus.verified.value, None
    if outcome in _PROVIDER_SIDE:
        return VerificationStatus.retrying.value, now + PROVIDER_PAUSE
    if failures <= len(RETRY_DELAYS):
        return VerificationStatus.retrying.value, now + RETRY_DELAYS[failures - 1]
    return VerificationStatus.failed.value, None


async def _claim(session: AsyncSession, receipt_id: int, *, trigger: str, now: datetime) -> tuple[str, int] | None:
    """Lease the receipt for one attempt. Returns (qr_raw, attempt_no) or None if not eligible."""
    conditions = [
        Receipt.id == receipt_id,
        Receipt.qr_raw.is_not(None),
        Receipt.is_deleted.is_(False),
        # One attempt at a time for every trigger (cron, pipeline, admin).
        or_(Receipt.verification_locked_until.is_(None), Receipt.verification_locked_until < now),
    ]
    if trigger == "cron":
        conditions += [
            Receipt.verification_status.in_(_ACTIVE),
            Receipt.next_verification_at <= now,
            Receipt.status == ReceiptStatus.on_review.value,
        ]
    elif trigger == "pipeline":
        conditions.append(Receipt.verification_status.in_(_ACTIVE))
    else:  # admin: any QR receipt, any time
        conditions.append(Receipt.verification_status != VerificationStatus.not_required.value)
    async with session.begin():
        row = (
            await session.execute(
                update(Receipt)
                .where(*conditions)
                .values(verification_locked_until=now + ATTEMPT_LEASE)
                .returning(Receipt.qr_raw, Receipt.verification_attempts)
            )
        ).one_or_none()
    if row is None:
        return None
    return row.qr_raw, row.verification_attempts + 1


def _ofd_items(result: VerificationResult) -> list[dict]:
    if result.receipt is None:
        return []
    return [{"raw_name": it.name, "qty": it.quantity, "price": it.price} for it in result.receipt.items]


async def run_attempt(session: AsyncSession, receipt_id: int, verifier: Verifier, *, trigger: str) -> VerificationResult | None:
    """Run one verification attempt; returns the result, or None if the receipt was not eligible."""
    now = datetime.now(UTC)
    claimed = await _claim(session, receipt_id, trigger=trigger, now=now)
    if claimed is None:
        return None
    qr_raw, attempt_no = claimed
    method = method_for_attempt(verifier.methods, attempt_no)

    try:
        data: FiscalData | None = parse_qr(qr_raw, now=now + timedelta(days=3650))
    except FiscalValidationError as exc:
        data = None
        result = VerificationResult(VerificationOutcome.invalid, {"qr": qr_raw}, error=f"{exc.code}: {exc.message}")
    if data is not None:
        try:
            result = await verifier.verify(data, method, attempt_no)
        except Exception as exc:  # noqa: BLE001 — a provider bug must not leave the lease dangling
            logger.exception("verification.provider_crash, receipt_id=%d", receipt_id)
            result = VerificationResult(VerificationOutcome.error, {}, error=f"{type(exc).__name__}: {exc}"[:500])

    done_at = datetime.now(UTC)
    async with session.begin():
        receipt = (await session.execute(select(Receipt).where(Receipt.id == receipt_id).with_for_update())).scalar_one()
        session.add(
            ReceiptVerificationAttempt(
                receipt_id=receipt_id,
                attempt_no=attempt_no,
                provider=verifier.provider,
                method=method,
                trigger=trigger,
                outcome=result.outcome.value,
                http_status=result.http_status,
                request=result.request,
                response=result.response,
                error=result.error,
                duration_ms=result.duration_ms,
            )
        )
        receipt.verification_attempts = attempt_no
        receipt.verification_locked_until = None
        if receipt.verification_status == VerificationStatus.verified.value and result.outcome is not VerificationOutcome.ok:
            # A forced re-check that failed never downgrades an already verified receipt.
            receipt.next_verification_at = None
        else:
            if result.outcome is not VerificationOutcome.ok and result.outcome not in _PROVIDER_SIDE:
                receipt.verification_failures += 1
            status, next_at = next_state(receipt.verification_failures, result.outcome, done_at)
            receipt.verification_status = status
            receipt.next_verification_at = next_at
            if result.outcome is VerificationOutcome.ok:
                _apply_ofd_answer(receipt, result, data, done_at)
    logger.info(
        "verification.attempt, receipt_id=%d, attempt=%d, provider=%s, method=%s, trigger=%s, outcome=%s",
        receipt_id, attempt_no, verifier.provider, method, trigger, result.outcome.value,
    )
    return result


def _apply_ofd_answer(receipt: Receipt, result: VerificationResult, data: FiscalData | None, now: datetime) -> None:
    """Store the final OFD answer and enrich the receipt (shop, items); flag a sum mismatch."""
    receipt.verified_at = now
    receipt.ofd_response = result.response
    ofd = result.receipt
    if ofd is None:
        return
    receipt.shop_name = receipt.shop_name or ofd.shop_name
    receipt.shop_inn = receipt.shop_inn or ofd.shop_inn
    if not receipt.items:
        receipt.items = _ofd_items(result)
    qr_sum = data.total_sum_kop if data else receipt.total_sum
    if qr_sum and ofd.total_sum and abs(ofd.total_sum - qr_sum) > qr_sum * SUM_TOLERANCE:
        signal = FraudChecker.qr_ofd_mismatch_signal(qr_sum=qr_sum, ofd_sum=ofd.total_sum).to_dict()
        receipt.fraud_signals = [*(receipt.fraud_signals or []), signal]


async def due_receipt_ids(session: AsyncSession, *, now: datetime | None = None, limit: int = CRON_BATCH) -> list[int]:
    now = now or datetime.now(UTC)
    rows = await session.execute(
        select(Receipt.id)
        .where(
            _ACTIVE_SQL,
            Receipt.next_verification_at <= now,
            Receipt.status == ReceiptStatus.on_review.value,
            Receipt.is_deleted.is_(False),
            or_(Receipt.verification_locked_until.is_(None), Receipt.verification_locked_until < now),
        )
        .order_by(Receipt.next_verification_at)
        .limit(limit)
    )
    ids = list(rows.scalars())
    await session.commit()  # end the read transaction before the attempts open their own
    return ids


async def retry_due(session: AsyncSession, verifier: Verifier, *, time_budget_s: float = CRON_TIME_BUDGET_S) -> int:
    """Cron body: one attempt per due receipt, sequential (provider rate limits) and
    time-bounded (arq job timeout) — what is left over runs on the next tick."""
    done = 0
    started = time.monotonic()
    for receipt_id in await due_receipt_ids(session):
        if time.monotonic() - started > time_budget_s:
            break
        if await run_attempt(session, receipt_id, verifier, trigger="cron") is not None:
            done += 1
    return done
