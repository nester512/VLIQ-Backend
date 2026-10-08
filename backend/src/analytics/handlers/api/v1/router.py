"""Admin analytics API (A4 / UC-01)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.analytics.schemas.api import AdminDashboard
from src.analytics.service import get_admin_dashboard
from src.app.auth.jwt import JwtTokenT, require_admin
from src.app.depends import get_pg_session

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get(
    "/dashboard",
    response_model=AdminDashboard,
    summary="Метрики главной админки — агрегаты по всей БД",
)
async def get_dashboard(
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> AdminDashboard:
    return await get_admin_dashboard(session)
