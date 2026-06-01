from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.depends import get_pg_session
from src.seller.repository import SellerRepository


def get_seller_repository(
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SellerRepository:
    return SellerRepository(session=session)
