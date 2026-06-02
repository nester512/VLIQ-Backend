"""Seller repository — race-condition-safe upsert and basic queries.

H14: IntegrityError on phone_e164 raises AppError("SELLER_PHONE_TAKEN", 409) — a single
unified error envelope — instead of propagating or returning a legacy ``detail`` string.
H19: commit() removed — transaction management is the caller's responsibility.
"""

from __future__ import annotations

import logging
from contextlib import suppress

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.errors import AppError
from src.seller.errors import is_phone_conflict
from src.seller.models import Seller, SellerStatus

logger = logging.getLogger(__name__)


class SellerRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_telegram_id(self, telegram_id: int) -> Seller | None:
        res = await self.session.execute(select(Seller).where(Seller.telegram_id == telegram_id))
        return res.scalars().first()

    async def get_by_telegram_id_or_404(self, telegram_id: int) -> Seller:
        seller = await self.get_by_telegram_id(telegram_id)
        if seller is None:
            raise AppError("SELLER_NOT_FOUND", status_code=404)
        return seller

    async def ensure_seller(
        self,
        *,
        telegram_id: int,
        brand_id: int,
        phone_e164: str,
        first_name: str | None = None,
        last_name: str | None = None,
    ) -> Seller:
        """Upsert seller by telegram_id.

        H14: Raises AppError("SELLER_PHONE_TAKEN", 409) when an IntegrityError is caused by a
        phone_e164 conflict, rather than silently swallowing it as a generic 500.
        H19: Does not call session.commit() — callers must manage transactions.
        """
        seller = await self.get_by_telegram_id(telegram_id)
        if seller is None:
            seller = Seller(
                telegram_id=telegram_id,
                brand_id=brand_id,
                phone_e164=phone_e164,
                first_name=first_name,
                last_name=last_name,
                status=SellerStatus.pending.value,
            )
            try:
                self.session.add(seller)
                await self.session.flush()
                await self.session.refresh(seller)
                logger.info("seller_created telegram_id=%s", telegram_id)
                return seller
            except IntegrityError as exc:
                await self.session.rollback()

                # H14: Differentiate phone vs telegram_id conflicts.
                if is_phone_conflict(exc):
                    raise AppError("SELLER_PHONE_TAKEN", status_code=409) from exc

                # Telegram_id conflict — another worker inserted concurrently; return existing.
                existing = await self.get_by_telegram_id(telegram_id)
                if existing is not None:
                    return existing
                raise
            except Exception:
                with suppress(Exception):
                    await self.session.rollback()
                raise

        # Existing seller — update optional fields if provided and changed.
        changed = False
        if first_name and first_name != seller.first_name:
            seller.first_name = first_name
            changed = True
        if last_name and last_name != seller.last_name:
            seller.last_name = last_name
            changed = True
        if phone_e164 and phone_e164 != seller.phone_e164:
            seller.phone_e164 = phone_e164
            changed = True

        if changed:
            try:
                await self.session.flush()
                await self.session.refresh(seller)
            except IntegrityError as exc:
                await self.session.rollback()
                if is_phone_conflict(exc):
                    raise AppError("SELLER_PHONE_TAKEN", status_code=409) from exc
                raise
            except Exception:
                with suppress(Exception):
                    await self.session.rollback()
                raise

        return seller
