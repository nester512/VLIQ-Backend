"""Payout requests — money, lifecycle and receipt coverage (docs/design/PAYOUTS.md).

Every action is ONE transaction: the status change, its ledger row, the receipt
coverage / receipt journey events, the audit_log row and the seller notification
(outbox) are committed together or not at all.

  CREATE  (seller) new          + payout_hold −N   + coverage FIFO + included_in_payout
  TAKE    (admin)  in_progress
  APPROVE (admin)  paid         + payout_completed −N + receipts fully covered → paid_out
  REJECT  (admin)  rejected     + payout_reverted +N  + payout_reverted on receipts; reason required
  EDIT    (admin)  amount Δ     + payout_hold −Δ      + coverage recomputed

Locks: the seller row serialises balance checks (create / amount increase); the
payout row serialises its own transitions; covered receipts are locked before
they are read so a concurrent receipt cancellation cannot slip in between.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.errors import AppError
from src.audit_log.models import AuditLog
from src.bonus_transaction.models import BonusTransaction, BonusTransactionKind
from src.notification import outbox as notification_outbox
from src.notification.formatting import format_kopecks
from src.payout_request.models import ACTIVE_PAYOUT_STATUSES, PayoutReceipt, PayoutRequest, PayoutRequestStatus
from src.payout_request.schemas.api import PayoutRequestRead
from src.receipt.models import EventKind, Receipt, ReceiptStatus
from src.receipt_journey import service as journey
from src.seller.models import PayoutKind, Seller, SellerStatus
from src.seller.services.balance_service import get_seller_balance

logger = logging.getLogger(__name__)

_PHONE_RE = re.compile(r"^\+79\d{9}$")


def normalize_sbp_phone(raw: str) -> str:
    """SBP by phone needs a Russian mobile number: +7 9XX XXX-XX-XX → «+79XXXXXXXXX»."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 11 and digits[0] in "78":  # noqa: PLR2004
        digits = "7" + digits[1:]
    elif len(digits) == 10:  # noqa: PLR2004
        digits = "7" + digits
    phone = f"+{digits}"
    if not _PHONE_RE.match(phone):
        raise AppError(
            "PAYOUT_PHONE_INVALID",
            user_message="Укажите номер мобильного телефона для СБП: +7 9XX XXX-XX-XX.",
            status_code=422,
        )
    return phone


def _audit(  # noqa: PLR0913
    session: AsyncSession,
    *,
    actor_id: int,
    actor_type: str,
    action: str,
    payout_id: int,
    comment: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_id=actor_id, actor_type=actor_type, action=action, entity_type="payout",
            entity_id=payout_id, comment=comment, payload=payload,
        )
    )


def _read(payout: PayoutRequest) -> PayoutRequestRead:
    return PayoutRequestRead.model_validate(payout, from_attributes=True)


async def _fresh(session: AsyncSession, payout: PayoutRequest) -> PayoutRequestRead:
    """DTO after the pending writes — server-side timestamps are reloaded, not lazy-loaded."""
    await session.flush()
    await session.refresh(payout)
    return _read(payout)


async def _lock_payout(session: AsyncSession, payout_id: int) -> PayoutRequest:
    payout = (
        await session.execute(select(PayoutRequest).where(PayoutRequest.id == payout_id).with_for_update())
    ).scalar_one_or_none()
    if payout is None:
        raise AppError("PAYOUT_NOT_FOUND", status_code=404)
    return payout


async def _lock_seller(session: AsyncSession, seller_id: int) -> Seller:
    seller = (
        await session.execute(select(Seller).where(Seller.telegram_id == seller_id).with_for_update())
    ).scalar_one_or_none()
    if seller is None:
        raise AppError("SELLER_NOT_FOUND", status_code=404)
    return seller


async def _forbid_blocked_seller(session: AsyncSession, seller_id: int) -> None:
    """No money goes out to a blocked seller (S1 «двойной заслон»): take / pay are refused,
    rejecting (money back to the balance) stays possible. FOR SHARE: a concurrent block
    waits for this transaction, and this one sees a block that committed first."""
    status = (
        await session.execute(select(Seller.status).where(Seller.telegram_id == seller_id).with_for_update(read=True))
    ).scalar_one_or_none()
    if status == SellerStatus.blocked.value:
        raise AppError("PAYOUT_SELLER_BLOCKED", status_code=409)


def _insufficient(available: int) -> AppError:
    return AppError(
        "PAYOUT_INSUFFICIENT_BALANCE",
        user_message=f"Недостаточно средств. Доступно: {format_kopecks(max(available, 0))} ₽.",
        status_code=422,
    )


# ---- receipt coverage (BRD В-8-A) -------------------------------------------


async def covered_by_live_payouts(session: AsyncSession, receipt_ids: list[int]) -> dict[int, int]:
    """Receipt id → amount covered by payouts that are not rejected."""
    if not receipt_ids:
        return {}
    rows = await session.execute(
        select(PayoutReceipt.receipt_id, func.sum(PayoutReceipt.amount))
        .join(PayoutRequest, PayoutRequest.id == PayoutReceipt.payout_id)
        .where(PayoutReceipt.receipt_id.in_(receipt_ids), PayoutRequest.status != PayoutRequestStatus.rejected.value)
        .group_by(PayoutReceipt.receipt_id)
    )
    return {rid: int(total) for rid, total in rows.all()}


async def active_payout_of(session: AsyncSession, receipt_id: int) -> int | None:
    """The payout in progress (new / in_progress) covering this receipt, if any."""
    return (
        await session.execute(
            select(PayoutRequest.id)
            .join(PayoutReceipt, PayoutReceipt.payout_id == PayoutRequest.id)
            .where(PayoutReceipt.receipt_id == receipt_id, PayoutRequest.status.in_(ACTIVE_PAYOUT_STATUSES))
            .limit(1)
        )
    ).scalar_one_or_none()


async def _allocate(session: AsyncSession, payout: PayoutRequest, *, actor_type: str, actor_id: int) -> None:
    """Cover ``payout.amount`` with the seller's approved receipts, oldest first."""
    receipts = list(
        (
            await session.execute(
                select(Receipt)
                .where(
                    Receipt.seller_id == payout.seller_id,
                    Receipt.status == ReceiptStatus.approved.value,
                    Receipt.is_deleted.is_(False),
                    Receipt.bonus_amount > 0,
                )
                .order_by(Receipt.created_at, Receipt.id)
                .with_for_update()
            )
        ).scalars()
    )
    covered = await covered_by_live_payouts(session, [r.id for r in receipts])
    left = payout.amount
    for receipt in receipts:
        if left <= 0:
            break
        free = receipt.bonus_amount - covered.get(receipt.id, 0)
        if free <= 0:
            continue
        part = min(free, left)
        left -= part
        session.add(PayoutReceipt(payout_id=payout.id, receipt_id=receipt.id, amount=part))
        await journey.record(
            session, receipt.id, EventKind.included_in_payout, actor_type=actor_type, actor_id=actor_id,
            data={"payout_id": payout.id, "amount": part, "partial": part < receipt.bonus_amount},
        )


async def _links(session: AsyncSession, payout_id: int) -> list[PayoutReceipt]:
    return list(
        (
            await session.execute(
                select(PayoutReceipt).where(PayoutReceipt.payout_id == payout_id).order_by(PayoutReceipt.id)
            )
        ).scalars()
    )


# ---- seller ------------------------------------------------------------------


async def create_payout_request(  # noqa: PLR0913
    *,
    seller_id: int,
    amount: int,
    payout_kind: str,
    phone: str | None,
    idempotency_key: str,
    min_amount: int,
    session: AsyncSession,
) -> PayoutRequestRead:
    """Create a payout request, reserve the money and cover receipts — one transaction."""
    if payout_kind != PayoutKind.sbp_phone.value:
        raise AppError("PAYOUT_METHOD_UNSUPPORTED", user_message="Выплата возможна только по СБП.", status_code=422)
    destination = normalize_sbp_phone(phone or "")
    if amount < min_amount:
        raise AppError(
            "PAYOUT_BELOW_MINIMUM",
            user_message=f"Минимальная сумма выплаты — {format_kopecks(min_amount)} ₽.",
            status_code=422,
        )

    try:
        async with session.begin():
            seller = await _lock_seller(session, seller_id)
            existing = (
                await session.execute(
                    select(PayoutRequest).where(
                        PayoutRequest.seller_id == seller_id, PayoutRequest.idempotency_key == idempotency_key
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                logger.info("payout.idempotent_hit payout_id=%s", existing.id)
                return _read(existing)
            if seller.status != SellerStatus.active.value:
                raise AppError("SELLER_NOT_ACTIVE", status_code=403)

            balance = await get_seller_balance(seller_id=seller_id, session=session)
            if balance.available < amount:
                raise _insufficient(balance.available)

            payout = PayoutRequest(
                seller_id=seller_id,
                brand_id=seller.brand_id,
                amount=amount,
                payout_kind=payout_kind,
                payout_masked=destination,
                status=PayoutRequestStatus.new.value,
                idempotency_key=idempotency_key,
                created_by=seller_id,
            )
            session.add(payout)
            await session.flush()
            session.add(
                BonusTransaction(
                    seller_id=seller_id, brand_id=seller.brand_id, amount=-amount,
                    kind=BonusTransactionKind.payout_hold.value, source_type="payout", source_id=payout.id,
                    reason=f"Резерв по заявке на выплату #{payout.id}", created_by=seller_id,
                )
            )
            await _allocate(session, payout, actor_type="seller", actor_id=seller_id)
            # Defence in depth: a receipt cancellation's ledger row takes FOR KEY SHARE on the
            # seller (FK), so it already serialises with our seller FOR UPDATE — but re-read
            # the balance now that the receipts are ours: never reserve unbacked money.
            if (await get_seller_balance(seller_id=seller_id, session=session)).available < 0:
                raise _insufficient(balance.available - amount)
            _audit(session, actor_id=seller_id, actor_type="seller", action="create_payout", payout_id=payout.id,
                   payload={"amount": amount})  # fmt: skip
            result = await _fresh(session, payout)
    except IntegrityError:
        # Two submits with one key raced past the lookup — the unique index kept one.
        await session.rollback()
        existing = (
            await session.execute(
                select(PayoutRequest).where(
                    PayoutRequest.seller_id == seller_id, PayoutRequest.idempotency_key == idempotency_key
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise
        return _read(existing)

    logger.info("payout.created payout_id=%s seller_id=%s amount=%s", result.id, seller_id, amount)
    return result


# ---- admin -------------------------------------------------------------------


async def take_payout_request(*, payout_id: int, admin_id: int, session: AsyncSession) -> PayoutRequestRead:
    """new → in_progress («взята в работу»). Idempotent for in_progress."""
    async with session.begin():
        payout = await _lock_payout(session, payout_id)
        if payout.status == PayoutRequestStatus.new.value:
            await _forbid_blocked_seller(session, payout.seller_id)
            payout.status = PayoutRequestStatus.in_progress.value
            payout.taken_at = datetime.now(UTC)
            payout.updated_by = admin_id
            _audit(session, actor_id=admin_id, actor_type="admin", action="take_payout", payout_id=payout_id)
        elif payout.status != PayoutRequestStatus.in_progress.value:
            raise AppError("PAYOUT_INVALID_STATE", status_code=409)
        result = await _fresh(session, payout)
    return result


async def approve_payout_request(
    *,
    payout_id: int,
    admin_id: int,
    external_txn_id: str | None = None,
    session: AsyncSession,
) -> PayoutRequestRead:
    """Mark paid: ledger, «Выплачен» on fully covered receipts, «выплата отправлена» — atomically."""
    async with session.begin():
        payout = await _lock_payout(session, payout_id)
        if payout.status == PayoutRequestStatus.paid.value:
            return _read(payout)  # idempotent: nothing is written or sent twice
        if payout.status not in ACTIVE_PAYOUT_STATUSES:
            raise AppError("PAYOUT_INVALID_STATE", status_code=409)
        await _forbid_blocked_seller(session, payout.seller_id)

        now = datetime.now(UTC)
        payout.status = PayoutRequestStatus.paid.value
        payout.paid_at = now
        payout.updated_by = admin_id
        if external_txn_id:
            payout.external_txn_id = external_txn_id
        session.add(
            BonusTransaction(
                seller_id=payout.seller_id, brand_id=payout.brand_id, amount=-payout.amount,
                kind=BonusTransactionKind.payout_completed.value, source_type="payout", source_id=payout.id,
                reason=f"Выплата по заявке #{payout.id}", created_by=admin_id,
            )
        )
        await session.flush()

        links = await _links(session, payout_id)
        receipt_ids = [link.receipt_id for link in links]
        receipts = {
            r.id: r
            for r in (
                await session.execute(
                    # Same lock order as _allocate (oldest first) — no deadlock between them.
                    select(Receipt).where(Receipt.id.in_(receipt_ids)).order_by(Receipt.created_at, Receipt.id).with_for_update()
                )
            ).scalars()
        } if receipt_ids else {}  # fmt: skip
        paid_cover = dict(
            (
                await session.execute(
                    select(PayoutReceipt.receipt_id, func.sum(PayoutReceipt.amount))
                    .join(PayoutRequest, PayoutRequest.id == PayoutReceipt.payout_id)
                    .where(
                        PayoutReceipt.receipt_id.in_(receipt_ids),
                        PayoutRequest.status == PayoutRequestStatus.paid.value,
                    )
                    .group_by(PayoutReceipt.receipt_id)
                )
            ).all()
        ) if receipt_ids else {}  # fmt: skip
        fully_paid: list[int] = []
        for link in links:
            receipt = receipts.get(link.receipt_id)
            if receipt is None:
                continue
            full = int(paid_cover.get(receipt.id, 0)) >= receipt.bonus_amount
            if full and receipt.status == ReceiptStatus.approved.value:
                await session.execute(
                    update(Receipt).where(Receipt.id == receipt.id).values(
                        status=ReceiptStatus.paid_out.value, updated_by=admin_id
                    )
                )
                fully_paid.append(receipt.id)
            await journey.record(
                session, receipt.id, EventKind.paid_out, actor_type="admin", actor_id=admin_id,
                data={"payout_id": payout.id, "amount": link.amount, "partial": not full},
            )

        await notification_outbox.enqueue(
            session, recipient_id=payout.seller_id, channel="telegram", template="payout.sent",
            payload={"amount": payout.amount, "payout_masked": payout.payout_masked},
        )
        _audit(session, actor_id=admin_id, actor_type="admin", action="approve_payout", payout_id=payout_id,
               payload={"amount": payout.amount, "external_txn_id": external_txn_id, "receipts_paid_out": fully_paid})  # fmt: skip
        result = await _fresh(session, payout)

    logger.info("payout.approved payout_id=%s admin_id=%s receipts_paid_out=%s", payout_id, admin_id, len(fully_paid))
    return result


async def reject_payout_request(
    *,
    payout_id: int,
    admin_id: int,
    admin_comment: str | None = None,
    session: AsyncSession,
) -> PayoutRequestRead:
    """Reject with a reason: money back to the balance, receipts released, seller told why."""
    reason = (admin_comment or "").strip()
    async with session.begin():
        payout = await _lock_payout(session, payout_id)
        if payout.status == PayoutRequestStatus.rejected.value:
            return _read(payout)  # idempotent
        if payout.status not in ACTIVE_PAYOUT_STATUSES:
            raise AppError("PAYOUT_INVALID_STATE", status_code=409)
        if not reason:
            raise AppError("PAYOUT_REJECT_REASON_REQUIRED", user_message="Укажите причину отказа.", status_code=422)

        payout.status = PayoutRequestStatus.rejected.value
        payout.rejected_at = datetime.now(UTC)
        payout.admin_comment = reason
        payout.updated_by = admin_id
        session.add(
            BonusTransaction(
                seller_id=payout.seller_id, brand_id=payout.brand_id, amount=payout.amount,
                kind=BonusTransactionKind.payout_reverted.value, source_type="payout", source_id=payout.id,
                reason=f"Отказ по заявке #{payout.id}: {reason}", created_by=admin_id,
            )
        )
        for link in await _links(session, payout_id):
            await journey.record(
                session, link.receipt_id, EventKind.payout_reverted, actor_type="admin", actor_id=admin_id,
                data={"payout_id": payout.id, "amount": link.amount, "reason": reason},
            )
        await notification_outbox.enqueue(
            session, recipient_id=payout.seller_id, channel="telegram", template="payout.rejected",
            payload={"amount": payout.amount, "reason": reason},
        )
        _audit(session, actor_id=admin_id, actor_type="admin", action="reject_payout", payout_id=payout_id,
               comment=reason, payload={"amount": payout.amount})  # fmt: skip
        result = await _fresh(session, payout)

    logger.info("payout.rejected payout_id=%s admin_id=%s", payout_id, admin_id)
    return result


async def update_payout_request(  # noqa: PLR0913
    *,
    payout_id: int,
    admin_id: int,
    amount: int | None = None,
    admin_comment: str | None = None,
    external_txn_id: str | None = None,
    session: AsyncSession,
) -> PayoutRequestRead:
    """Edit a payout in progress (KAN-22): amount Δ is reserved / released and coverage recomputed."""
    async with session.begin():
        payout = await _lock_payout(session, payout_id)
        if payout.status not in ACTIVE_PAYOUT_STATUSES:
            raise AppError("PAYOUT_INVALID_STATE", status_code=409)

        old_amount = payout.amount
        changes: dict[str, Any] = {}
        if amount is not None and amount != old_amount:
            delta = amount - old_amount
            if delta > 0:
                await _lock_seller(session, payout.seller_id)
                balance = await get_seller_balance(seller_id=payout.seller_id, session=session)
                if balance.available < delta:
                    raise _insufficient(balance.available)
            session.add(
                BonusTransaction(
                    seller_id=payout.seller_id, brand_id=payout.brand_id, amount=-delta,
                    kind=BonusTransactionKind.payout_hold.value, source_type="payout", source_id=payout.id,
                    reason=f"Изменение суммы заявки #{payout.id} админом", created_by=admin_id,
                )
            )
            payout.amount = amount
            # Coverage of a payout in progress is recomputed from scratch; the receipts'
            # journey keeps both the old and the new inclusion.
            await session.execute(delete(PayoutReceipt).where(PayoutReceipt.payout_id == payout.id))
            await session.flush()
            await _allocate(session, payout, actor_type="admin", actor_id=admin_id)
            if delta > 0 and (await get_seller_balance(seller_id=payout.seller_id, session=session)).available < 0:
                raise _insufficient(0)  # a receipt was cancelled meanwhile (see create)
            await notification_outbox.enqueue(
                session, recipient_id=payout.seller_id, channel="telegram", template="payout.amount_changed",
                payload={"amount": amount, "old_amount": old_amount, "payout_masked": payout.payout_masked},
            )
            changes["amount"] = {"before": old_amount, "after": amount}
        if admin_comment is not None:
            payout.admin_comment = admin_comment
            changes["admin_comment"] = admin_comment
        if external_txn_id is not None:
            payout.external_txn_id = external_txn_id
            changes["external_txn_id"] = external_txn_id
        if changes:
            payout.updated_by = admin_id
            _audit(session, actor_id=admin_id, actor_type="admin", action="edit_payout", payout_id=payout_id,
                   payload=changes)  # fmt: skip
        result = await _fresh(session, payout)

    logger.info("payout.updated payout_id=%s admin_id=%s amount=%s", payout_id, admin_id, result.amount)
    return result
