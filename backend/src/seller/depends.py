from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.auth.jwt import JwtTokenT, validate_token_dependency
from src.app.depends import get_pg_session
from src.seller.repository import SellerRepository


def get_seller_repository(
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SellerRepository:
    return SellerRepository(session=session)


def forbid_blocked_seller(
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
) -> JwtTokenT:
    """S1 "двойной заслон": a blocked seller cannot act, even with a JWT issued before the block.

    The check itself now runs for every request in ``validate_token_dependency``
    (``check_account_access``: blocked seller, switched-off lost account after account
    recovery — docs/procedures/ACCOUNT-RECOVERY.md). Kept on the mutating seller routes
    so they say what they guard.
    """
    return token
