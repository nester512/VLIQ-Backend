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
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.prometheus_metrics import ofd_request_duration_seconds, ofd_requests_total
from src.fraud.checks import FraudChecker
from src.receipt.models import (
    CheckProvider,
    EventKind,
    Receipt,
    ReceiptEvent,
    ReceiptStatus,
    ReceiptVerificationAttempt,
    VerificationOutcome,
    VerificationStatus,
)
from src.receipt_intake.fiscal import FiscalData, FiscalValidationError, parse_qr
from src.receipt_journey import service as journey
from src.receipt_verification.providers import ProviderRegistry, register_outcome
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
# …growing with every such round in a row (a quota that ran out, no provider connected
# at all): checking every hour forever only filled the receipt journey with noise.
PROVIDER_PAUSES: tuple[timedelta, ...] = (
    PROVIDER_PAUSE, timedelta(hours=3), timedelta(hours=6), timedelta(hours=12), timedelta(hours=24),
)
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


def next_state(
    failures: int, outcome: VerificationOutcome, now: datetime, *, provider_rounds: int = 1
) -> tuple[str, datetime | None]:
    """(verification_status, next_verification_at) after an attempt.

    ``failures`` — budget-counting failures INCLUDING this attempt (unchanged for
    provider-side outcomes, which pause instead of spending the budget).
    ``provider_rounds`` — how many rounds so far ended on the provider side (incl. this one):
    the pause grows 1 h → 24 h.
    """
    if outcome is VerificationOutcome.ok:
        return VerificationStatus.verified.value, None
    if outcome in _PROVIDER_SIDE:
        pause = PROVIDER_PAUSES[min(max(provider_rounds, 1), len(PROVIDER_PAUSES)) - 1]
        return VerificationStatus.retrying.value, now + pause
    if failures <= len(RETRY_DELAYS):
        return VerificationStatus.retrying.value, now + RETRY_DELAYS[failures - 1]
    return VerificationStatus.failed.value, None


_TRIGGER_ACTOR = {"pipeline": "system", "cron": "system", "admin": "admin"}


async def _claim(session: AsyncSession, receipt_id: int, *, trigger: str, now: datetime) -> tuple[str, int] | None:
    """Lease the receipt for one round. Returns (qr_raw, round_no) or None if not eligible."""
    conditions = [
        Receipt.id == receipt_id,
        Receipt.qr_raw.is_not(None),
        Receipt.is_deleted.is_(False),
        # One round at a time for every trigger (cron, pipeline, admin).
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
                .returning(Receipt.qr_raw, Receipt.check_rounds)
            )
        ).one_or_none()
    if row is None:
        return None
    return row.qr_raw, row.check_rounds + 1


def _ofd_items(result: VerificationResult) -> list[dict]:
    if result.receipt is None:
        return []
    return [{"raw_name": it.name, "qty": it.quantity, "price": it.price} for it in result.receipt.items]


def _parsed(result: VerificationResult) -> dict | None:
    """Provider-independent normalised answer (what the journey shows and compares)."""
    r = result.receipt
    if r is None:
        return None
    return {
        "total_sum": r.total_sum,
        "purchase_date": r.purchase_date.isoformat() if r.purchase_date else None,
        "shop_name": r.shop_name,
        "shop_inn": r.shop_inn,
        "items": [{"name": it.name, "qty": it.quantity, "price": it.price} for it in r.items],
    }


@dataclass
class RoundResult:
    round_no: int
    outcome: VerificationOutcome  # ok if any provider confirmed the receipt
    verified_by: str | None
    calls: list[tuple[str, VerificationResult]]


async def _call(verifier: Verifier, data: FiscalData | None, qr_raw: str, method: str, round_no: int) -> VerificationResult:
    if data is None:
        return VerificationResult(VerificationOutcome.invalid, {"qr": qr_raw}, error="QR не проходит валидацию")
    try:
        return await verifier.verify(data, method, round_no)
    except Exception as exc:  # noqa: BLE001 — a provider bug must not leave the lease dangling
        logger.exception("verification.provider_crash, provider=%s", verifier.provider)
        return VerificationResult(VerificationOutcome.error, {}, error=f"{type(exc).__name__}: {exc}"[:500])


async def run_round(  # noqa: PLR0912, PLR0913, PLR0915
    session: AsyncSession,
    receipt_id: int,
    registry: ProviderRegistry,
    *,
    trigger: str,
    actor_id: int | None = None,
    only_provider: str | None = None,
) -> RoundResult | None:
    """One check round: the enabled, connected providers in order until one confirms.

    Every provider call is an attempt row (exact request + raw response) and a
    ``provider_checked`` journey event; the round start/end are events too.
    Returns None when the receipt is not eligible (not QR, leased, nothing due).
    """
    now = datetime.now(UTC)
    claimed = await _claim(session, receipt_id, trigger=trigger, now=now)
    if claimed is None:
        return None
    qr_raw, round_no = claimed
    actor = _TRIGGER_ACTOR.get(trigger, "system")
    try:
        data: FiscalData | None = parse_qr(qr_raw, now=now + timedelta(days=3650))
    except FiscalValidationError:
        data = None

    async with session.begin():
        slots, skipped = await registry.chain(session, now, only=only_provider)
        # Still no provider connected, and the journey already says so: reschedule silently
        # instead of writing the same two steps again every time the cron comes by.
        quiet_since = (
            await _last_said_no_provider(session, receipt_id) if not slots and not skipped and trigger == "cron" else None
        )
        quiet = quiet_since is not None
        if not quiet:
            await journey.record(
                session, receipt_id, EventKind.check_round_started, actor_type=actor, actor_id=actor_id,
                data={"round": round_no, "providers": [s.row.code for s in slots], "trigger": trigger,
                      **({"only": only_provider} if only_provider else {})},
            )
        for row in skipped:
            await journey.record(
                session, receipt_id, EventKind.provider_skipped, actor_type="system", source=row.code,
                data={"round": round_no, "until": row.disabled_until.isoformat() if row.disabled_until else None},
            )
    plan = [(s.row.code, s.row.role, s.verifier) for s in slots]

    calls: list[tuple[str, VerificationResult]] = []
    verified_by: str | None = None
    winner: VerificationResult | None = None
    for code, role, verifier in plan:
        method = method_for_attempt(verifier.methods, round_no)
        result = await _call(verifier, data, qr_raw, method, round_no)
        finished = datetime.now(UTC)
        async with session.begin():
            receipt = (await session.execute(select(Receipt).where(Receipt.id == receipt_id).with_for_update())).scalar_one()
            attempt = ReceiptVerificationAttempt(
                receipt_id=receipt_id,
                attempt_no=receipt.verification_attempts + 1,
                round_no=round_no,
                provider=code,
                provider_role=role,
                adapter_version=getattr(verifier, "adapter_version", None),
                method=method,
                trigger=trigger,
                outcome=result.outcome.value,
                http_status=result.http_status,
                request=result.request,
                response=result.response,
                parsed=_parsed(result),
                error=result.error,
                duration_ms=result.duration_ms,
            )
            session.add(attempt)
            receipt.verification_attempts += 1
            await session.flush()
            provider_row = (await session.execute(select(CheckProvider).where(CheckProvider.code == code))).scalar_one()
            register_outcome(provider_row, result.outcome, finished)
            ofd_requests_total.labels(provider=code, status=result.outcome.value).inc()
            if result.duration_ms is not None:
                ofd_request_duration_seconds.labels(provider=code).observe(result.duration_ms / 1000)
            await journey.record(
                session, receipt_id, EventKind.provider_checked, actor_type=actor, actor_id=actor_id, source=code,
                outcome=result.outcome.value, check_id=attempt.id,
                data={"round": round_no, "method": method, "role": role},
            )
        calls.append((code, result))
        if result.outcome is VerificationOutcome.ok:
            verified_by, winner = code, result
            break

    done_at = datetime.now(UTC)
    async with session.begin():
        receipt = (await session.execute(select(Receipt).where(Receipt.id == receipt_id).with_for_update())).scalar_one()
        if not quiet:
            receipt.check_rounds = round_no
        receipt.verification_locked_until = None
        if winner is not None:
            receipt.verification_status = VerificationStatus.verified.value
            receipt.next_verification_at = None
            receipt.verified_by = verified_by
            _apply_ofd_answer(receipt, winner, data, done_at)
            await journey.record(
                session, receipt_id, EventKind.verified, actor_type="system", source=verified_by, outcome="ok",
                data={"round": round_no},
            )
            outcome = VerificationOutcome.ok
        else:
            outcome = _round_outcome(calls)
            if receipt.verification_status == VerificationStatus.verified.value:
                receipt.next_verification_at = None  # a failed forced re-check never downgrades «verified»
            else:
                if outcome not in _PROVIDER_SIDE:
                    receipt.verification_failures += 1
                status, next_at = next_state(
                    receipt.verification_failures, outcome, done_at,
                    provider_rounds=max(round_no - receipt.verification_failures, 1),
                )
                if quiet_since is not None:  # still nothing connected: wait about twice as long as so far
                    wait = min(max((done_at - quiet_since) * 2, PROVIDER_PAUSES[0]), PROVIDER_PAUSES[-1])
                    next_at = done_at + wait
                receipt.verification_status = status
                receipt.next_verification_at = next_at
            kind = (
                EventKind.check_exhausted
                if receipt.verification_status == VerificationStatus.failed.value
                else EventKind.check_round_failed
            )
            if not quiet:
                await journey.record(
                    session, receipt_id, kind, actor_type="system", outcome=outcome.value,
                    data={
                        "round": round_no,
                        "next_at": receipt.next_verification_at.isoformat() if receipt.next_verification_at else None,
                        **({} if calls else {"reason": "no_provider_available"}),
                    },
                )
    logger.info(
        "verification.round, receipt_id=%d, round=%d, trigger=%s, calls=%s, outcome=%s",
        receipt_id, round_no, trigger, [(c, r.outcome.value) for c, r in calls], outcome.value,
    )
    return RoundResult(round_no=round_no, outcome=outcome, verified_by=verified_by, calls=calls)


async def _last_said_no_provider(session: AsyncSession, receipt_id: int) -> datetime | None:
    """When the journey's last step already says «no provider connected» — its time, else None."""
    last = (
        await session.execute(
            select(ReceiptEvent.kind, ReceiptEvent.data, ReceiptEvent.at)
            .where(ReceiptEvent.receipt_id == receipt_id)
            .order_by(ReceiptEvent.seq.desc())
            .limit(1)
        )
    ).one_or_none()
    said = last and last.kind == EventKind.check_round_failed and (last.data or {}).get("reason") == "no_provider_available"
    return last.at if said else None


def _round_outcome(calls: list[tuple[str, VerificationResult]]) -> VerificationOutcome:
    """A round without a confirmation: a receipt-side answer (not_found / invalid) wins over
    provider faults; only-provider-faults (or no provider at all) → rate_limited = pause, no budget spent."""
    outcomes = [r.outcome for _, r in calls]
    for o in (VerificationOutcome.not_found, VerificationOutcome.invalid):
        if o in outcomes:
            return o
    return VerificationOutcome.rate_limited


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


async def retry_due(
    session: AsyncSession, registry: ProviderRegistry, *, time_budget_s: float = CRON_TIME_BUDGET_S
) -> int:
    """Cron body: one attempt per due receipt, sequential (provider rate limits) and
    time-bounded (arq job timeout) — what is left over runs on the next tick."""
    done = 0
    started = time.monotonic()
    for receipt_id in await due_receipt_ids(session):
        if time.monotonic() - started > time_budget_s:
            break
        if await run_round(session, receipt_id, registry, trigger="cron") is not None:
            done += 1
    return done
