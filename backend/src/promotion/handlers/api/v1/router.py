from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.auth.jwt import JwtTokenT, validate_token_dependency
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.promotion.models import Promotion, PromotionStatus
from src.promotion.schemas.api import PromotionCreate, PromotionRead, PromotionUpdate

router = APIRouter(prefix="/promotions", tags=["Promotion"])


@router.post("", response_model=PromotionRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_promotion(payload: PromotionCreate) -> PromotionRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.get(
    "",
    response_model=list[PromotionRead],
    summary="Список акций бренда (TMA + admin)",
    description=(
        "Возвращает акции в статусе active/paused для отображения в "
        "Mini App. Сортируется по priority desc, ends_at asc."
    ),
)
async def list_promotions(
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    brand_id: int | None = Query(default=None, description="Filter by brand"),
    only_active: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[PromotionRead]:
    stmt = select(Promotion)
    if brand_id is not None:
        stmt = stmt.where(Promotion.brand_id == brand_id)
    if only_active:
        now = datetime.utcnow()
        stmt = stmt.where(
            Promotion.status.in_([PromotionStatus.active.value, PromotionStatus.paused.value]),
            Promotion.ends_at >= now,
        )
    stmt = stmt.order_by(Promotion.priority.desc(), Promotion.ends_at.asc()).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return [PromotionRead.model_validate(p, from_attributes=True) for p in rows]


@router.get("/{promotion_id}", response_model=PromotionRead, include_in_schema=False)
async def get_promotion(promotion_id: int) -> PromotionRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.patch("/{promotion_id}", response_model=PromotionRead, include_in_schema=False)
async def update_promotion(promotion_id: int, payload: PromotionUpdate) -> PromotionRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.delete("/{promotion_id}", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def delete_promotion(promotion_id: int) -> None:
    raise AppError("NOT_IMPLEMENTED", status_code=501)
