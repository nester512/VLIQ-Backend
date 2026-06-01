from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.auth.jwt import JwtTokenT, validate_token_dependency
from src.app.depends import get_pg_session
from src.city.models import City
from src.city.schemas.api import CityRead

router = APIRouter(prefix="/cities", tags=["City"])


@router.get(
    "",
    response_model=list[CityRead],
    summary="Справочник городов (источник правды для формы регистрации)",
    description="Активные города, отсортированные по sort_order, затем по name.",
)
async def list_cities(
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    include_inactive: bool = Query(default=False),
) -> list[CityRead]:
    stmt = select(City)
    if not include_inactive:
        stmt = stmt.where(City.is_active.is_(True))
    stmt = stmt.order_by(City.sort_order.asc(), City.name.asc())
    rows = (await session.execute(stmt)).scalars().all()
    return [CityRead.model_validate(c, from_attributes=True) for c in rows]
