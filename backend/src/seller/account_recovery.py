"""Recovering a seller who lost his Telegram account (docs/procedures/ACCOUNT-RECOVERY.md).

Only a super_admin, after the identity check, links the seller's NEW Telegram account:
the seller's data never moves (receipts, ledger, payouts keep pointing at his original
``telegram_id``); the new account is added to ``seller_login`` and the lost one is
switched off. Never automatic, never by name or phone; every transfer is audited.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.models import Admin
from src.app.errors import AppError
from src.audit_log.models import AuditLog
from src.bonus_transaction.models import BonusTransaction
from src.payout_request.models import ACTIVE_PAYOUT_STATUSES, PayoutRequest
from src.receipt.models import Receipt
from src.seller.models import Seller, SellerLogin, SellerStatus

MIN_REASON = 10  # «основание» must say something: who checked what


async def login_seller_id(session: AsyncSession, telegram_id: int) -> int | None:
    """The seller this Telegram account logs in as through a recovery link, if any."""
    return (
        await session.execute(
            select(SellerLogin.seller_id).where(SellerLogin.telegram_id == telegram_id, SellerLogin.revoked_at.is_(None))
        )
    ).scalar_one_or_none()


async def chat_id_for(session: AsyncSession, seller_id: int) -> int:
    """Where to send the seller's Telegram messages: his current (recovered) account."""
    linked = (
        await session.execute(
            select(SellerLogin.telegram_id)
            .where(SellerLogin.seller_id == seller_id, SellerLogin.revoked_at.is_(None))
            .order_by(SellerLogin.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return linked if linked is not None else seller_id


async def _has_data(session: AsyncSession, seller_id: int) -> bool:
    for model in (Receipt, BonusTransaction, PayoutRequest):
        if await session.scalar(select(exists().where(model.seller_id == seller_id))):
            return True
    return False


async def transfer_login(
    session: AsyncSession, *, seller_id: int, new_telegram_id: int, reason: str, actor_id: int
) -> dict:
    """Link ``new_telegram_id`` to ``seller_id`` and switch the lost account off — one transaction."""
    reason = (reason or "").strip()
    if len(reason) < MIN_REASON:
        raise AppError("ACCOUNT_TRANSFER_REASON_REQUIRED", status_code=422)
    if new_telegram_id == seller_id:
        raise AppError("ACCOUNT_TRANSFER_SAME_ACCOUNT", status_code=422)

    async with session.begin():
        seller = (
            await session.execute(select(Seller).where(Seller.telegram_id == seller_id).with_for_update())
        ).scalar_one_or_none()
        if seller is None:
            raise AppError("SELLER_NOT_FOUND", status_code=404)

        existing = (
            await session.execute(select(SellerLogin).where(SellerLogin.telegram_id == new_telegram_id))
        ).scalar_one_or_none()
        if existing is not None and existing.revoked_at is None:
            if existing.seller_id == seller_id:  # a repeated request: already done
                return {"seller_id": seller_id, "telegram_id": new_telegram_id, "already_linked": True}
            raise AppError("ACCOUNT_TRANSFER_CONFLICT", status_code=409, extra={"linked_to": existing.seller_id})
        if await session.scalar(select(exists().where(Admin.telegram_id == new_telegram_id))):
            raise AppError("ACCOUNT_TRANSFER_CONFLICT", status_code=409, extra={"reason": "admin_account"})

        # Money first: a payout in progress is decided before its owner changes accounts.
        in_progress = await session.scalar(
            select(func.count()).where(PayoutRequest.seller_id == seller_id, PayoutRequest.status.in_(ACTIVE_PAYOUT_STATUSES))
        )
        if in_progress:
            raise AppError("ACCOUNT_TRANSFER_PAYOUT_IN_PROGRESS", status_code=409, extra={"payouts": int(in_progress)})

        # The new Telegram account may already have opened the app: that auto-creates an
        # EMPTY pending seller. Only such an empty stub may be removed; a real account
        # (registered / with receipts, money or payouts) is a conflict for a human to sort out.
        other = (
            await session.execute(select(Seller).where(Seller.telegram_id == new_telegram_id).with_for_update())
        ).scalar_one_or_none()
        if other is not None:
            if other.status != SellerStatus.pending.value or await _has_data(session, new_telegram_id):
                raise AppError("ACCOUNT_TRANSFER_CONFLICT", status_code=409, extra={"reason": "active_account"})
            await session.delete(other)
            await session.flush()

        if existing is not None:  # a revoked link of this very account: re-activate it for this seller
            await session.execute(
                update(SellerLogin).where(SellerLogin.telegram_id == new_telegram_id).values(
                    seller_id=seller_id, reason=reason, created_by=actor_id, created_at=func.now(), revoked_at=None
                )
            )
        else:
            session.add(SellerLogin(telegram_id=new_telegram_id, seller_id=seller_id, reason=reason, created_by=actor_id))
        # Any earlier recovered account of this seller and the original one stop working.
        await session.execute(
            update(SellerLogin)
            .where(SellerLogin.seller_id == seller_id, SellerLogin.telegram_id != new_telegram_id, SellerLogin.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
        seller.primary_login_disabled = True
        session.add(
            AuditLog(
                actor_id=actor_id, actor_type="admin", action="transfer_seller_login", entity_type="seller",
                entity_id=seller_id, comment=reason,
                payload={"old_telegram_id": seller_id, "new_telegram_id": new_telegram_id,
                         "removed_empty_stub": other is not None},
            )
        )  # fmt: skip
    return {"seller_id": seller_id, "telegram_id": new_telegram_id, "already_linked": False}
