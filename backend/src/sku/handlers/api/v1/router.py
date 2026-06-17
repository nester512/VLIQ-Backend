"""SKU (товары) admin CRUD — UC-02 «Добавить/Просмотреть/Удалить товар».

Admin-only management of the brand's product catalog. Fields map to the spec:
  код маркировки → code · название → name · категория → category · сумма выплат → default_bonus
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.auth.jwt import JwtTokenT, require_admin
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.sku.models import Sku
from src.sku.schemas.api import SkuCreate, SkuRead, SkuUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skus", tags=["Sku"])


@router.post("", response_model=SkuRead, status_code=status.HTTP_201_CREATED)
async def create_sku(
    payload: SkuCreate,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SkuRead:
    """Create a product (UC-02). `code` (код маркировки) must be unique."""
    existing = (
        await session.execute(select(Sku).where(Sku.code == payload.code))
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(
            "VALIDATION_ERROR",
            user_message="Товар с таким кодом маркировки уже существует.",
            status_code=409,
            extra={"existing_sku_id": existing.id},
        )

    sku = Sku(
        brand_id=payload.brand_id,
        code=payload.code,
        name=payload.name,
        category=payload.category,
        default_bonus=payload.default_bonus,
        aliases=payload.aliases,
        is_active=payload.is_active,
        created_by=token["user_id"],
    )
    session.add(sku)
    await session.commit()
    await session.refresh(sku)
    logger.info("sku.created, sku_id=%d, code=%s, admin=%d", sku.id, sku.code, token["user_id"])
    return SkuRead.model_validate(sku)


@router.get("", response_model=list[SkuRead])
async def list_skus(  # noqa: PLR0913
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    brand_id: int | None = Query(default=None),
    category: str | None = Query(default=None, description="Точная категория для фильтра"),
    q: str | None = Query(default=None, description="Поиск по названию / коду (ILIKE)"),
    is_active: bool | None = Query(default=None),
) -> list[SkuRead]:
    """List products with basic filters, ordered by category then name (UC-02)."""
    stmt = select(Sku)
    if brand_id is not None:
        stmt = stmt.where(Sku.brand_id == brand_id)
    if category is not None:
        stmt = stmt.where(Sku.category == category)
    if is_active is not None:
        stmt = stmt.where(Sku.is_active.is_(is_active))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Sku.name.ilike(like) | Sku.code.ilike(like))

    stmt = stmt.order_by(Sku.category.asc().nulls_last(), Sku.name.asc())
    rows = (await session.execute(stmt)).scalars().all()
    return [SkuRead.model_validate(r) for r in rows]


@router.get("/{sku_id}", response_model=SkuRead)
async def get_sku(
    sku_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SkuRead:
    sku = (await session.execute(select(Sku).where(Sku.id == sku_id))).scalar_one_or_none()
    if sku is None:
        raise AppError("RECEIPT_NOT_FOUND", user_message="Товар не найден.", status_code=404)
    return SkuRead.model_validate(sku)


@router.patch("/{sku_id}", response_model=SkuRead)
async def update_sku(
    sku_id: int,
    payload: SkuUpdate,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SkuRead:
    sku = (await session.execute(select(Sku).where(Sku.id == sku_id))).scalar_one_or_none()
    if sku is None:
        raise AppError("RECEIPT_NOT_FOUND", user_message="Товар не найден.", status_code=404)
    data = payload.model_dump(exclude_none=True)
    if data:
        data["updated_by"] = token["user_id"]
        await session.execute(update(Sku).where(Sku.id == sku_id).values(**data))
        await session.commit()
        await session.refresh(sku)
    return SkuRead.model_validate(sku)


@router.delete("/{sku_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sku(
    sku_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> None:
    """Delete a product by id (UC-02, с подтверждением на фронте)."""
    sku = (await session.execute(select(Sku).where(Sku.id == sku_id))).scalar_one_or_none()
    if sku is None:
        raise AppError("RECEIPT_NOT_FOUND", user_message="Товар не найден.", status_code=404)
    await session.delete(sku)
    await session.commit()
    logger.info("sku.deleted, sku_id=%d, admin=%d", sku_id, token["user_id"])
