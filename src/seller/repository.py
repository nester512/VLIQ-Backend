"""Seller repository — minimal, just enough to support /sellers/tg-upsert.

Mirrors TopApp's ClientRepository.ensure_client (race-condition-safe upsert).
"""
from __future__ import annotations

import logging
from contextlib import suppress
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.seller.models import Seller, SellerStatus

logger = logging.getLogger(__name__)


class SellerRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_telegram_id(self, telegram_id: int) -> Optional[Seller]:
        res = await self.session.execute(select(Seller).where(Seller.telegram_id == telegram_id))
        return res.scalars().first()

    async def ensure_seller(
        self,
        *,
        telegram_id: int,
        brand_id: int,
        phone_e164: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
    ) -> Seller:
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
                await self.session.commit()
                logger.info("seller_created telegram_id=%s", telegram_id)
                return seller
            except IntegrityError:
                await self.session.rollback()
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
                await self.session.commit()
            except Exception:
                with suppress(Exception):
                    await self.session.rollback()
                raise

        return seller
