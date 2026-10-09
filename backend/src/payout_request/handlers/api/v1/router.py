"""Payout request API (docs/design/PAYOUTS.md).

Seller: create (Idempotency-Key — one request per key, enforced by the DB), «Мои заявки».
Admin: list + totals over ALL matching requests, take / approve / reject / edit,
receipts covered by a request.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

import structlog
from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.api.pagination import PagedResponse
from src.app.auth.jwt import JwtTokenT, require_admin, require_seller, validate_token_dependency
from src.app.depends import get_config, get_pg_session
from src.app.errors import AppError
from src.app.settings import Settings
from src.payout_request.models import ACTIVE_PAYOUT_STATUSES, PayoutReceipt, PayoutRequest, PayoutRequestStatus
from src.payout_request.schemas.api import (
    PayoutCoverageRead,
    PayoutRequestApprove,
    PayoutRequestCreate,
    PayoutRequestRead,
    PayoutRequestReject,
    PayoutRequestUpdate,
    PayoutStatusTotal,
    PayoutSummaryRead,
)
from src.payout_request.service import (
    approve_payout_request,
    create_payout_request,
    reject_payout_request,
    take_payout_request,
    update_payout_request,
)
from src.receipt.models import Receipt
from src.seller.blocked import is_blocked
from src.seller.depends import forbid_blocked_seller
from src.seller.handlers.api.v1.router import seller_search_condition
from src.seller.models import Seller

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/payout-requests", tags=["Payout Requests"])

BlockedScope = Literal["exclude", "only", "include"]
_BLOCKED_DOC = (
    "exclude (default) — requests in progress of BLOCKED sellers are left out (they cannot be paid); "
    "only — just blocked sellers' requests; include — everything"
)


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
        item.seller_status = str(getattr(seller.status, "value", seller.status))
    return items


def _filtered(  # noqa: PLR0913
    stmt: Select,
    *,
    seller_id: int | None,
    brand_id: int | None,
    req_status: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    search: str | None,
    blocked: str = "exclude",
) -> Select:
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
    # Requests IN PROGRESS of blocked sellers are not work (they cannot be paid): out of
    # the main queue and its totals, reachable via blocked=only; paid / rejected stay history.
    active_of_blocked = PayoutRequest.status.in_(ACTIVE_PAYOUT_STATUSES) & is_blocked(PayoutRequest.seller_id)
    if blocked == "exclude":
        stmt = stmt.where(~active_of_blocked)
    elif blocked == "only":
        stmt = stmt.where(is_blocked(PayoutRequest.seller_id))
    if search and search.strip():
        term = search.strip()
        by_seller = PayoutRequest.seller_id.in_(select(Seller.telegram_id).where(seller_search_condition(term)))
        if term.isascii() and term.isdigit() and len(term) <= 18:  # noqa: PLR2004
            by_seller = by_seller | (PayoutRequest.id == int(term))
        stmt = stmt.where(by_seller)
    return stmt


@router.post(
    "",
    response_model=PayoutRequestRead,
    dependencies=[Depends(forbid_blocked_seller)],
    status_code=status.HTTP_201_CREATED,
    summary="Создать заявку на выплату",
    description=(
        "Одной транзакцией: заявка, резерв суммы, покрытие одобренных чеков (с самых старых). "
        "`Idempotency-Key` уникален в пределах продавца — повтор вернёт ту же заявку."
    ),
)
async def create_payout_request_endpoint(
    body: PayoutRequestCreate,
    token: Annotated[JwtTokenT, Depends(require_seller)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    cfg: Annotated[Settings, Depends(get_config)],
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        min_length=8,
        max_length=64,
        description="One key per submitted form (UUID).",
    ),
) -> PayoutRequestRead:
    return await create_payout_request(
        seller_id=token["user_id"],
        amount=body.amount,
        payout_kind=body.payout_kind.value,
        phone=body.phone or body.payout_masked,
        idempotency_key=idempotency_key,
        min_amount=cfg.PAYOUT_MIN_AMOUNT,
        session=session,
    )


@router.post("/{payout_request_id}/take", response_model=PayoutRequestRead, summary="Взять заявку в работу (admin)")
async def take_payout(
    payout_request_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> PayoutRequestRead:
    return await take_payout_request(payout_id=payout_request_id, admin_id=token["user_id"], session=session)


@router.post("/{payout_request_id}/approve", response_model=PayoutRequestRead, summary="Отметить «Выплачено» (admin)")
async def approve_payout(
    payout_request_id: int,
    body: PayoutRequestApprove,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> PayoutRequestRead:
    return await approve_payout_request(
        payout_id=payout_request_id,
        admin_id=token["user_id"],
        external_txn_id=body.external_txn_id,
        session=session,
    )


@router.post("/{payout_request_id}/reject", response_model=PayoutRequestRead, summary="Отклонить с причиной (admin)")
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
    summary="Список заявок (admin) с пагинацией и фильтрами",
)
async def list_payout_requests(  # noqa: PLR0913
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    seller_id: int | None = Query(default=None),
    brand_id: int | None = Query(default=None),
    req_status: PayoutRequestStatus | None = Query(default=None, alias="status"),
    date_from: datetime | None = Query(default=None),  # noqa: B008
    date_to: datetime | None = Query(default=None),  # noqa: B008
    search: str | None = Query(default=None, max_length=100),
    blocked: BlockedScope = Query(default="exclude", description=_BLOCKED_DOC),
    order: Literal["desc", "asc"] = Query(default="desc", description="By creation time: newest (desc) or oldest first"),
) -> PagedResponse[PayoutRequestRead]:
    stmt = _filtered(
        select(PayoutRequest), seller_id=seller_id, brand_id=brand_id,
        req_status=req_status.value if req_status else None, date_from=date_from, date_to=date_to, search=search,
        blocked=blocked,
    )  # fmt: skip
    total: int = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    by = (PayoutRequest.created_at.asc(), PayoutRequest.id.asc()) if order == "asc" else (
        PayoutRequest.created_at.desc(), PayoutRequest.id.desc()
    )
    stmt = stmt.order_by(*by).offset((page - 1) * limit).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    items = [PayoutRequestRead.model_validate(r, from_attributes=True) for r in rows]
    await _attach_seller_info(session, items)
    return PagedResponse.build(items=items, total=total, page=page, limit=limit)


@router.get(
    "/summary",
    response_model=PayoutSummaryRead,
    summary="Итоги по ВСЕМ заявкам под фильтрами (admin)",
    description="Количество и сумма по каждому статусу — считается в БД, а не по загруженной странице.",
)
async def payout_summary(  # noqa: PLR0913
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    seller_id: int | None = Query(default=None),
    brand_id: int | None = Query(default=None),
    date_from: datetime | None = Query(default=None),  # noqa: B008
    date_to: datetime | None = Query(default=None),  # noqa: B008
    search: str | None = Query(default=None, max_length=100),
) -> PayoutSummaryRead:
    stmt = _filtered(
        select(PayoutRequest.status, func.count(), func.coalesce(func.sum(PayoutRequest.amount), 0)),
        seller_id=seller_id, brand_id=brand_id, req_status=None, date_from=date_from, date_to=date_to, search=search,
    ).group_by(PayoutRequest.status)  # fmt: skip
    totals = {
        str(getattr(st, "value", st)): PayoutStatusTotal(count=int(n), amount=int(s))
        for st, n, s in (await session.execute(stmt)).all()
    }
    month = _filtered(
        select(func.count(), func.coalesce(func.sum(PayoutRequest.amount), 0)).where(
            PayoutRequest.status == PayoutRequestStatus.paid.value,
            func.coalesce(PayoutRequest.paid_at, PayoutRequest.updated_at) >= func.date_trunc("month", func.now()),
        ),
        seller_id=seller_id, brand_id=brand_id, req_status=None, date_from=None, date_to=None, search=search,
    )  # fmt: skip
    n_month, sum_month = (await session.execute(month)).one()
    held = _filtered(
        select(func.count(), func.coalesce(func.sum(PayoutRequest.amount), 0)).where(
            PayoutRequest.status.in_(ACTIVE_PAYOUT_STATUSES)
        ),
        seller_id=seller_id, brand_id=brand_id, req_status=None, date_from=date_from, date_to=date_to, search=search,
        blocked="only",
    )  # fmt: skip
    n_held, sum_held = (await session.execute(held)).one()
    return PayoutSummaryRead(
        **totals,
        paid_this_month=PayoutStatusTotal(count=int(n_month), amount=int(sum_month)),
        blocked_in_progress=PayoutStatusTotal(count=int(n_held), amount=int(sum_held)),
    )


@router.get(
    "/me",
    response_model=list[PayoutRequestRead],
    summary="Мои заявки на выплату (seller) — S5.5",
    description="Заявки продавца со статусами и причиной отказа, новые сверху.",
)
async def list_my_payout_requests(
    token: Annotated[JwtTokenT, Depends(require_seller)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> list[PayoutRequestRead]:
    stmt = (
        select(PayoutRequest)
        .where(PayoutRequest.seller_id == token["user_id"])
        .order_by(PayoutRequest.created_at.desc(), PayoutRequest.id.desc())
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [PayoutRequestRead.model_validate(r, from_attributes=True) for r in rows]


async def _get_visible(session: AsyncSession, payout_request_id: int, token: JwtTokenT) -> PayoutRequest:
    row = (
        await session.execute(select(PayoutRequest).where(PayoutRequest.id == payout_request_id))
    ).scalar_one_or_none()
    if row is None:
        raise AppError("PAYOUT_NOT_FOUND", status_code=404)
    if token.get("role") == "seller" and row.seller_id != token["user_id"]:
        raise AppError("AUTH_FORBIDDEN", status_code=403)
    return row


@router.get("/{payout_request_id}", response_model=PayoutRequestRead)
async def get_payout_request(
    payout_request_id: int,
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> PayoutRequestRead:
    row = await _get_visible(session, payout_request_id, token)
    item = PayoutRequestRead.model_validate(row, from_attributes=True)
    if token.get("role") != "seller":
        await _attach_seller_info(session, [item])
    return item


@router.get(
    "/{payout_request_id}/receipts",
    response_model=list[PayoutCoverageRead],
    summary="Чеки, покрытые заявкой (admin) — В-8-A",
)
async def payout_receipts(
    payout_request_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> list[PayoutCoverageRead]:
    await _get_visible(session, payout_request_id, token)
    rows = (
        await session.execute(
            select(PayoutReceipt.receipt_id, PayoutReceipt.amount, Receipt.bonus_amount, Receipt.status,
                   Receipt.purchase_date, Receipt.total_sum)  # fmt: skip
            .join(Receipt, Receipt.id == PayoutReceipt.receipt_id)
            .where(PayoutReceipt.payout_id == payout_request_id)
            .order_by(PayoutReceipt.id)
        )
    ).all()
    return [
        PayoutCoverageRead(
            receipt_id=r.receipt_id, amount=r.amount, bonus_amount=r.bonus_amount,
            receipt_status=str(getattr(r.status, "value", r.status)), purchase_date=r.purchase_date,
            total_sum=r.total_sum,
        )
        for r in rows
    ]


@router.patch(
    "/{payout_request_id}",
    response_model=PayoutRequestRead,
    summary="Изменить заявку (admin): сумма / комментарий / номер транзакции — KAN-22",
    description=(
        "Только для заявок «новая / в обработке». Изменение суммы резервирует / освобождает разницу "
        "и пересчитывает покрытие чеков. Смена статуса — только через /take, /approve, /reject."
    ),
)
async def update_payout_request_endpoint(
    payout_request_id: int,
    payload: PayoutRequestUpdate,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> PayoutRequestRead:
    return await update_payout_request(
        payout_id=payout_request_id,
        admin_id=token["user_id"],
        amount=payload.amount,
        admin_comment=payload.admin_comment,
        external_txn_id=payload.external_txn_id,
        session=session,
    )


@router.delete("/{payout_request_id}", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def delete_payout_request(payout_request_id: int) -> None:
    raise AppError("NOT_IMPLEMENTED", status_code=501)
