"""Payout request service — atomic payout flow (H13).

All state transitions happen within a single database transaction:
  CREATE  → INSERT payout_request(status=new) + INSERT bonus_transaction(kind=payout_hold, amount=-N)
  APPROVE → UPDATE status=paid              + INSERT bonus_transaction(kind=payout_completed, amount=-N)
  REJECT  → UPDATE status=rejected          + INSERT bonus_transaction(kind=payout_reverted, amount=+N)

SELECT ... FOR UPDATE is used on the seller row to prevent concurrent over-spend.
Idempotency-Key is stored in Redis for 24 h (H15).
"""

from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.bonus_transaction.models import BonusTransaction, BonusTransactionKind
from src.payout_request.models import PayoutRequest, PayoutRequestStatus
from src.payout_request.schemas.api import PayoutRequestRead
from src.seller.models import Seller
from src.seller.services.balance_service import get_seller_balance

logger = logging.getLogger(__name__)

_IDEMPOTENCY_TTL = timedelta(hours=24)
_IDEMPOTENCY_PREFIX = "idempotency:payout:"


async def _get_idempotency_key(redis: Redis, key: str) -> PayoutRequestRead | None:
    """Return cached payout read response if idempotency key already processed."""
    raw = await redis.get(f"{_IDEMPOTENCY_PREFIX}{key}")
    if raw is None:
        return None
    try:
        return PayoutRequestRead.model_validate_json(raw)
    except Exception:
        logger.warning("idempotency.bad_cache key=%s", key)
        return None


async def _set_idempotency_key(redis: Redis, key: str, payout: PayoutRequestRead) -> None:
    """Cache payout result under idempotency key for 24 h."""
    await redis.set(
        f"{_IDEMPOTENCY_PREFIX}{key}",
        payout.model_dump_json(),
        ex=int(_IDEMPOTENCY_TTL.total_seconds()),
    )


async def create_payout_request(  # noqa: PLR0913
    *,
    seller_id: int,
    amount: int,
    payout_kind: str,
    payout_masked_override: str | None,
    session: AsyncSession,
    redis: Redis,
    idempotency_key: str,
) -> PayoutRequestRead:
    """Atomically create a payout request and hold the balance.

    Steps (all in one transaction):
      1. SELECT seller FOR UPDATE; derive brand_id + payout account from it.
      2. Compute available balance; raise 422 if insufficient.
      3. INSERT payout_request(status=new)
      4. INSERT bonus_transaction(kind=payout_hold, amount=-amount)

    The seller is resolved HERE (not in the endpoint): a pre-query in the
    endpoint autobegins a transaction on the session, so the `session.begin()`
    below would raise "A transaction is already begun on this Session".
    """
    # Check idempotency cache first — before acquiring any DB lock.
    cached = await _get_idempotency_key(redis, idempotency_key)
    if cached is not None:
        logger.info("payout.idempotent_hit key=%s", idempotency_key)
        return cached

    async with session.begin():
        # Lock seller row to prevent concurrent over-spend.
        seller_row = (
            await session.execute(select(Seller).where(Seller.telegram_id == seller_id).with_for_update())
        ).scalar_one_or_none()

        if seller_row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Seller not found")

        # Derive brand + payout account from the locked row (request body may
        # override the masked account for this single payout).
        brand_id = seller_row.brand_id
        payout_masked = payout_masked_override or seller_row.payout_masked
        if not payout_masked:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Payout account not set")

        # Compute available balance within the same transaction.
        balance = await get_seller_balance(seller_id=seller_id, session=session)

        if balance.available < amount:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Insufficient balance: available={balance.available}, requested={amount}",
            )

        payout = PayoutRequest(
            seller_id=seller_id,
            brand_id=brand_id,
            amount=amount,
            payout_kind=payout_kind,
            payout_masked=payout_masked,
            status=PayoutRequestStatus.new.value,
        )
        session.add(payout)
        await session.flush()  # get payout.id

        hold = BonusTransaction(
            seller_id=seller_id,
            brand_id=brand_id,
            amount=-amount,  # negative — reduces available balance
            kind=BonusTransactionKind.payout_hold.value,
            source_type="payout",
            source_id=payout.id,
        )
        session.add(hold)

    await session.refresh(payout)
    result = PayoutRequestRead.model_validate(payout, from_attributes=True)

    # Cache result after successful commit.
    await _set_idempotency_key(redis, idempotency_key, result)
    logger.info("payout.created payout_id=%s seller_id=%s amount=%s", payout.id, seller_id, amount)
    return result


async def approve_payout_request(
    *,
    payout_id: int,
    admin_id: int,
    external_txn_id: str | None = None,
    session: AsyncSession,
) -> PayoutRequestRead:
    """Atomically approve a payout request.

    Transition: new/in_progress → paid
    Also inserts bonus_transaction(kind=payout_completed, amount=-amount).
    """
    async with session.begin():
        payout = (
            await session.execute(select(PayoutRequest).where(PayoutRequest.id == payout_id).with_for_update())
        ).scalar_one_or_none()

        if payout is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "PayoutRequest not found")

        if payout.status == PayoutRequestStatus.paid.value:
            # Already paid — idempotent.
            pass
        elif payout.status not in (PayoutRequestStatus.new.value, PayoutRequestStatus.in_progress.value):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=f"Cannot approve payout in status={payout.status}",
            )
        else:
            payout.status = PayoutRequestStatus.paid.value
            payout.updated_by = admin_id
            if external_txn_id:
                payout.external_txn_id = external_txn_id

            completed = BonusTransaction(
                seller_id=payout.seller_id,
                brand_id=payout.brand_id,
                amount=-payout.amount,  # negative — the money left the ledger
                kind=BonusTransactionKind.payout_completed.value,
                source_type="payout",
                source_id=payout.id,
                created_by=admin_id,
            )
            session.add(completed)

    await session.refresh(payout)
    logger.info("payout.approved payout_id=%s admin_id=%s", payout_id, admin_id)
    return PayoutRequestRead.model_validate(payout, from_attributes=True)


async def reject_payout_request(
    *,
    payout_id: int,
    admin_id: int,
    admin_comment: str | None = None,
    session: AsyncSession,
) -> PayoutRequestRead:
    """Atomically reject a payout request and revert the held balance.

    Transition: new/in_progress → rejected
    Also inserts bonus_transaction(kind=payout_reverted, amount=+amount).
    """
    async with session.begin():
        payout = (
            await session.execute(select(PayoutRequest).where(PayoutRequest.id == payout_id).with_for_update())
        ).scalar_one_or_none()

        if payout is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "PayoutRequest not found")

        if payout.status == PayoutRequestStatus.rejected.value:
            # Already rejected — idempotent.
            pass
        elif payout.status not in (PayoutRequestStatus.new.value, PayoutRequestStatus.in_progress.value):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=f"Cannot reject payout in status={payout.status}",
            )
        else:
            payout.status = PayoutRequestStatus.rejected.value
            payout.updated_by = admin_id
            if admin_comment:
                payout.admin_comment = admin_comment

            reverted = BonusTransaction(
                seller_id=payout.seller_id,
                brand_id=payout.brand_id,
                amount=payout.amount,  # positive — balance restored
                kind=BonusTransactionKind.payout_reverted.value,
                source_type="payout",
                source_id=payout.id,
                created_by=admin_id,
            )
            session.add(reverted)

    await session.refresh(payout)
    logger.info("payout.rejected payout_id=%s admin_id=%s", payout_id, admin_id)
    return PayoutRequestRead.model_validate(payout, from_attributes=True)
