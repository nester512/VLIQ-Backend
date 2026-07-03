"""Payout request API router.

H13: Real atomic payout flow (create, approve, reject) with SELECT FOR UPDATE.
H15: Idempotency-Key header required on POST — stored in Redis 24 h.
H25: Pagination + filters on GET list.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Header, Query, status
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.api.pagination import PagedResponse
from src.app.auth.jwt import JwtTokenT, require_admin, require_seller, validate_token_dependency
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.notification import outbox as notification_outbox
from src.payout_request.depends import get_redis
from src.payout_request.models import PayoutRequest
from src.payout_request.schemas.api import (
    PayoutRequestApprove,
    PayoutRequestCreate,
    PayoutRequestRead,
    PayoutRequestReject,
    PayoutRequestUpdate,
)
from src.payout_request.service import (
    approve_payout_request,
    create_payout_request,
    reject_payout_request,
)
from src.seller.models import Seller

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/payout-requests", tags=["Payout Requests"])


async def _attach_seller_info(
    session: AsyncSession,
    items: list[PayoutRequestRead],
) -> list[PayoutRequestRead]:
    """Decorate admin payout DTOs with seller display data for the review UI."""
    seller_ids = {item.seller_id for item in items}
    if not seller_ids:
        return items

    sellers = (
        (await session.execute(select(Seller).where(Seller.telegram_id.in_(seller_ids))))
        .scalars()
        .all()
    )
    seller_by_id = {s.telegram_id: s for s in sellers}
    for item in items:
        seller = seller_by_id.get(item.seller_id)
        if seller is None:
            continue
        name = " ".join(p for p in [seller.first_name, seller.last_name] if p).strip()
        item.seller_name = name or seller.phone_e164 or f"Продавец #{item.seller_id}"
        item.seller_store = seller.outlet_name
    return items


@router.post(
    "",
    response_model=PayoutRequestRead,
    status_code=status.HTTP_201_CREATED,
    summary="Создать заявку на выплату (H13, H15)",
    description=(
        "Атомарно создаёт PayoutRequest + payout_hold транзакцию. "
        "Требует заголовок `Idempotency-Key` — повторный запрос с тем же ключом вернёт исходный ответ."
    ),
)
async def create_payout_request_endpoint(
    body: PayoutRequestCreate,
    token: Annotated[JwtTokenT, Depends(require_seller)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    redis: Annotated[Redis, Depends(get_redis)],
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        description="Client-generated unique key (UUID recommended). Stored 24 h to prevent duplicate requests.",
    ),
) -> PayoutRequestRead:
    # NB: do NOT query the session here before delegating — a read autobegins a
    # transaction and the service's `session.begin()` would then raise
    # "A transaction is already begun". The service resolves the seller itself
    # (locked SELECT ... FOR UPDATE) and derives brand_id + payout account.
    return await create_payout_request(
        seller_id=token["user_id"],
        amount=body.amount,
        payout_kind=body.payout_kind.value,
        payout_masked_override=body.payout_masked,
        session=session,
        redis=redis,
        idempotency_key=idempotency_key,
    )


@router.post(
    "/{payout_request_id}/approve",
    response_model=PayoutRequestRead,
    summary="Одобрить заявку (admin)",
)
async def approve_payout(
    payout_request_id: int,
    body: PayoutRequestApprove,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> PayoutRequestRead:
    result = await approve_payout_request(
        payout_id=payout_request_id,
        admin_id=token["user_id"],
        external_txn_id=body.external_txn_id,
        session=session,
    )

    # Enqueue Telegram notification via outbox.
    # approve_payout_request already committed its own transaction; the session
    # has auto-begun a new implicit transaction (from the post-commit refresh).
    # Calling session.begin() again would raise InvalidRequestError — use the
    # live implicit transaction directly and commit it explicitly instead.
    await notification_outbox.enqueue(
        session,
        recipient_id=result.seller_id,
        channel="telegram",
        template="payout.sent",
        payload={
            "amount": result.amount,
            "payout_masked": result.payout_masked,
        },
    )
    await session.commit()

    return result


@router.post(
    "/{payout_request_id}/reject",
    response_model=PayoutRequestRead,
    summary="Отклонить заявку (admin)",
)
async def reject_payout(
    payout_request_id: int,
    body: PayoutRequestReject,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> PayoutRequestRead:
    return await reject_payout_request(
        payout_id=payout_request_id,
        admin_id=token["user_id"],
        admin_comment=body.admin_comment,
        session=session,
    )


@router.get(
    "",
    response_model=PagedResponse[PayoutRequestRead],
    summary="Список заявок (admin) с пагинацией и фильтрами (H25)",
)
async def list_payout_requests(  # noqa: PLR0913
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    seller_id: int | None = Query(default=None),
    brand_id: int | None = Query(default=None),
    req_status: str | None = Query(default=None, alias="status"),
    date_from: datetime | None = Query(default=None),  # noqa: B008
    date_to: datetime | None = Query(default=None),  # noqa: B008
) -> PagedResponse[PayoutRequestRead]:
    stmt = select(PayoutRequest)

    if seller_id is not None:
        stmt = stmt.where(PayoutRequest.seller_id == seller_id)
    if brand_id is not None:
        stmt = stmt.where(PayoutRequest.brand_id == brand_id)
    if req_status is not None:
        stmt = stmt.where(PayoutRequest.status == req_status)
    if date_from is not None:
        stmt = stmt.where(PayoutRequest.created_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(PayoutRequest.created_at <= date_to)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(PayoutRequest.created_at.desc()).offset((page - 1) * limit).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    items = [PayoutRequestRead.model_validate(r, from_attributes=True) for r in rows]
    await _attach_seller_info(session, items)
    return PagedResponse.build(items=items, total=total, page=page, limit=limit)


@router.get(
    "/me",
    response_model=list[PayoutRequestRead],
    summary="Мои заявки на выплату (seller) — S5.5",
    description="Список заявок текущего продавца со статусами (new → in_progress → paid/rejected), новые сверху.",
)
async def list_my_payout_requests(
    token: Annotated[JwtTokenT, Depends(require_seller)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> list[PayoutRequestRead]:
    """Seller-scoped payout-requests list (S5.5 «Мои заявки на выплату»)."""
    seller_id = token["user_id"]
    stmt = (
        select(PayoutRequest)
        .where(PayoutRequest.seller_id == seller_id)
        .order_by(PayoutRequest.created_at.desc())
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [PayoutRequestRead.model_validate(r, from_attributes=True) for r in rows]


@router.get("/{payout_request_id}", response_model=PayoutRequestRead)
async def get_payout_request(
    payout_request_id: int,
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> PayoutRequestRead:
    row = (
        await session.execute(select(PayoutRequest).where(PayoutRequest.id == payout_request_id))
    ).scalar_one_or_none()
    if row is None:
        raise AppError("RECEIPT_NOT_FOUND", status_code=404)

    # Sellers can only view their own requests.
    if token.get("role") == "seller" and row.seller_id != token["user_id"]:
        raise AppError("AUTH_FORBIDDEN", status_code=403)

    item = PayoutRequestRead.model_validate(row, from_attributes=True)
    if token.get("role") != "seller":
        await _attach_seller_info(session, [item])
    return item


@router.patch("/{payout_request_id}", response_model=PayoutRequestRead, include_in_schema=False)
async def update_payout_request(payout_request_id: int, payload: PayoutRequestUpdate) -> PayoutRequestRead:
    """Direct PATCH — prefer /approve or /reject action endpoints for state transitions."""
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.delete("/{payout_request_id}", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def delete_payout_request(payout_request_id: int) -> None:
    raise AppError("NOT_IMPLEMENTED", status_code=501)
