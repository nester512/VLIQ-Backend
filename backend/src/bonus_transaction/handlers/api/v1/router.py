"""Bonus transaction API router.

H26: PATCH and DELETE return 405 — bonus_transaction is append-only ledger.
H25: Pagination + filters on GET list.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.api.pagination import PagedResponse
from src.app.auth.jwt import JwtTokenT, validate_token_dependency
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.bonus_transaction.models import BonusTransaction
from src.bonus_transaction.schemas.api import (
    BonusTransactionCreate,
    BonusTransactionRead,
    BonusTransactionUpdate,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/bonus-transactions", tags=["Bonus Transactions"])


@router.post("", response_model=BonusTransactionRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_bonus_transaction(payload: BonusTransactionCreate) -> BonusTransactionRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.get(
    "",
    response_model=PagedResponse[BonusTransactionRead],
    summary="Список бонусных транзакций с пагинацией и фильтрами (H25)",
)
async def list_bonus_transactions(  # noqa: PLR0913
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    seller_id: int | None = Query(default=None),
    brand_id: int | None = Query(default=None),
    kind: str | None = Query(default=None, description="Filter by transaction kind"),
    date_from: datetime | None = Query(default=None),  # noqa: B008
    date_to: datetime | None = Query(default=None),  # noqa: B008
) -> PagedResponse[BonusTransactionRead]:
    stmt = select(BonusTransaction)

    role = token.get("role")
    user_id = token.get("user_id")

    # Sellers can only see their own transactions.
    if role == "seller":
        stmt = stmt.where(BonusTransaction.seller_id == user_id)
    elif seller_id is not None:
        stmt = stmt.where(BonusTransaction.seller_id == seller_id)

    if brand_id is not None:
        stmt = stmt.where(BonusTransaction.brand_id == brand_id)
    if kind is not None:
        stmt = stmt.where(BonusTransaction.kind == kind)
    if date_from is not None:
        stmt = stmt.where(BonusTransaction.created_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(BonusTransaction.created_at <= date_to)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(BonusTransaction.created_at.desc()).offset((page - 1) * limit).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    items = [BonusTransactionRead.model_validate(r, from_attributes=True) for r in rows]
    return PagedResponse.build(items=items, total=total, page=page, limit=limit)


@router.get("/{bonus_transaction_id}", response_model=BonusTransactionRead)
async def get_bonus_transaction(
    bonus_transaction_id: int,
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> BonusTransactionRead:
    row = (
        await session.execute(select(BonusTransaction).where(BonusTransaction.id == bonus_transaction_id))
    ).scalar_one_or_none()

    if row is None:
        raise AppError("RECEIPT_NOT_FOUND", status_code=404)

    if token.get("role") == "seller" and row.seller_id != token["user_id"]:
        raise AppError("AUTH_FORBIDDEN", status_code=403)

    return BonusTransactionRead.model_validate(row, from_attributes=True)


# H26: bonus_transaction is append-only — PATCH and DELETE return 405.


@router.patch(
    "/{bonus_transaction_id}",
    status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
    summary="Not allowed — bonus_transaction is append-only ledger (H26)",
    include_in_schema=True,
)
async def update_bonus_transaction(bonus_transaction_id: int, payload: BonusTransactionUpdate) -> Response:
    return Response(
        content='{"detail": "bonus_transaction is append-only; PATCH is not allowed"}',
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        media_type="application/json",
    )


@router.delete(
    "/{bonus_transaction_id}",
    status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
    summary="Not allowed — bonus_transaction is append-only ledger (H26)",
    include_in_schema=True,
)
async def delete_bonus_transaction(bonus_transaction_id: int) -> Response:
    return Response(
        content='{"detail": "bonus_transaction is append-only; DELETE is not allowed"}',
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        media_type="application/json",
    )
