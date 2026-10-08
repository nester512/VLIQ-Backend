from typing import Annotated

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.auth.jwt import JwtTokenT, validate_token_dependency
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.seller.models import Seller, SellerStatus
from src.seller.repository import SellerRepository


def get_seller_repository(
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SellerRepository:
    return SellerRepository(session=session)


async def forbid_blocked_seller(
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> JwtTokenT:
    """S1 "двойной заслон": a blocked seller cannot act, even with a JWT issued before the block.

    The login already refuses blocked sellers, but a token lives for days, so every
    mutating seller action re-checks the current status. Admin tokens pass through.
    """
    if token.get("role") == "seller":
        current_status = await session.scalar(select(Seller.status).where(Seller.telegram_id == token["user_id"]))
        if current_status == SellerStatus.blocked.value:
            raise AppError("SELLER_BLOCKED", status_code=403)
    return token
