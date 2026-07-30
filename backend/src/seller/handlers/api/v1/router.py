"""Seller API router.

H23: GET /sellers/me, /sellers/me/balance, /sellers/me/receipts, /sellers/me/notifications.
H25: Pagination + filters on list endpoints.
H6:  Rate limit on /tg-upsert via SlowAPI limiter.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.api.pagination import PagedResponse
from src.app.auth.jwt import JwtTokenT, require_admin, require_seller, validate_token_dependency
from src.app.crypto import PayoutCrypto
from src.app.depends import get_config, get_pg_session
from src.app.errors import AppError
from src.app.middleware.rate_limit import limiter
from src.app.settings import Settings
from src.audit_log.models import AuditLog
from src.city.repository import city_name_is_valid
from src.notification import outbox as notification_outbox
from src.notification.models import Notification
from src.notification.schemas.api import NotificationRead
from src.receipt.models import Receipt, ReceiptStatus
from src.receipt.schemas.api import ReceiptRead
from src.seller.depends import get_seller_repository
from src.seller.errors import is_phone_conflict
from src.seller.models import Seller, SellerStatus
from src.seller.repository import SellerRepository
from src.seller.schemas.api import (
    SellerBalanceRead,
    SellerBlockRequest,
    SellerCreate,
    SellerRead,
    SellerReadAdmin,
    SellerTgUpsertRequest,
    SellerUpdate,
)
from src.seller.services.balance_service import get_seller_balance

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/sellers", tags=["Sellers"])


# ---------------------------------------------------------------------------
# Self-service TMA endpoints (H23)
# ---------------------------------------------------------------------------


@router.get(
    "/me",
    response_model=SellerRead,
    summary="Получить профиль текущего продавца",
    description="Возвращает данные продавца из JWT-токена.",
)
async def get_me(
    token: Annotated[JwtTokenT, Depends(require_seller)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SellerRead:
    # Auto-heal: if the seller row is missing (e.g. DB was reset but the
    # signed JWT in localStorage is still valid), recreate as `pending` so
    # the RegPage flow can complete instead of trapping the user in 404 loop.
    telegram_id = token["user_id"]
    seller = (
        await session.execute(select(Seller).where(Seller.telegram_id == telegram_id))
    ).scalar_one_or_none()
    if seller is None:
        digits = str(telegram_id)[:13]
        seller = Seller(
            telegram_id=telegram_id,
            brand_id=1,
            phone_e164=f"+99{digits}",
            status="pending",
        )
        session.add(seller)
        await session.commit()
        await session.refresh(seller)
    return SellerRead.model_validate(seller, from_attributes=True)


@router.get(
    "/me/balance",
    response_model=SellerBalanceRead,
    summary="Баланс бонусов текущего продавца",
    description="Агрегат по bonus_transaction: available, on_hold, total_accrued, total_paid_out.",
)
async def get_me_balance(
    token: Annotated[JwtTokenT, Depends(require_seller)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SellerBalanceRead:
    return await get_seller_balance(seller_id=token["user_id"], session=session)


@router.get(
    "/me/receipts",
    response_model=PagedResponse[ReceiptRead],
    summary="История чеков текущего продавца",
)
async def get_me_receipts(  # noqa: PLR0913
    token: Annotated[JwtTokenT, Depends(require_seller)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    status: str | None = Query(default=None, description="Filter by receipt status"),
) -> PagedResponse[ReceiptRead]:
    seller_id = token["user_id"]

    stmt = select(Receipt).where(Receipt.seller_id == seller_id, Receipt.is_deleted.is_(False))

    if status is not None:
        try:
            receipt_status = ReceiptStatus(status)
        except ValueError as exc:
            raise AppError("VALIDATION_ERROR", status_code=422) from exc
        stmt = stmt.where(Receipt.status == receipt_status.value)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(Receipt.created_at.desc()).offset((page - 1) * limit).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    items = [ReceiptRead.model_validate(r, from_attributes=True) for r in rows]
    return PagedResponse.build(items=items, total=total, page=page, limit=limit)


@router.get(
    "/me/notifications",
    response_model=PagedResponse[NotificationRead],
    summary="Уведомления текущего продавца",
)
async def get_me_notifications(
    token: Annotated[JwtTokenT, Depends(require_seller)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    unread: bool | None = Query(default=None, description="true — только непрочитанные"),
    limit: int = Query(default=50, ge=1, le=200),
    page: int = Query(default=1, ge=1),
) -> PagedResponse[NotificationRead]:
    seller_id = token["user_id"]
    stmt = select(Notification).where(Notification.seller_id == seller_id)

    if unread is True:
        stmt = stmt.where(Notification.read_at.is_(None))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(Notification.created_at.desc()).offset((page - 1) * limit).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    items = [NotificationRead.model_validate(r, from_attributes=True) for r in rows]
    return PagedResponse.build(items=items, total=total, page=page, limit=limit)


# ---------------------------------------------------------------------------
# TMA upsert (H6 — rate limit 5/min per IP)
# ---------------------------------------------------------------------------


@router.patch(
    "/me",
    response_model=SellerRead,
    summary="Обновить профиль текущего продавца (TMA registration)",
    description=(
        "TMA-friendly self-update endpoint. Accepts the same body as the admin "
        "`PATCH /sellers/{telegram_id}` route but always scopes to the JWT subject. "
        "When the seller completes the required fields (phone, outlet name and "
        "number of outlets), the status auto-flips from `pending` → `active`."
    ),
)
async def update_me(
    payload: SellerUpdate,
    token: Annotated[JwtTokenT, Depends(require_seller)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    cfg: Annotated[Settings, Depends(get_config)],
) -> SellerRead:
    telegram_id = token["user_id"]
    row = (await session.execute(select(Seller).where(Seller.telegram_id == telegram_id))).scalar_one_or_none()
    if row is None:
        # Auto-heal (see get_me) — the JWT subject is trusted; recreate the row.
        digits = str(telegram_id)[:13]
        row = Seller(
            telegram_id=telegram_id,
            brand_id=1,
            phone_e164=f"+99{digits}",
            status="pending",
        )
        session.add(row)
        await session.flush()

    # City must belong to the dictionary (source of truth = vliq.city / GET /cities).
    if payload.city is not None and not await city_name_is_valid(session, payload.city):
        raise AppError("SELLER_CITY_INVALID", status_code=400)

    update_data = payload.model_dump(exclude_none=True, exclude={"payout_account_raw", "status"})

    # H7: encrypt payout account if provided, derive masked version.
    if payload.payout_account_raw:
        if cfg.PAYOUT_ENCRYPTION_KEY:
            crypto = PayoutCrypto(cfg.PAYOUT_ENCRYPTION_KEY)
            update_data["payout_encrypted"] = crypto.encrypt(payload.payout_account_raw)
            update_data["payout_masked"] = "•••• " + payload.payout_account_raw[-4:]
        else:
            logger.warning("update_me.no_encryption_key telegram_id=%s — payout_account_raw ignored", telegram_id)

    # Project the merged seller to decide if we should auto-activate.
    # S2.2 / S5.3: payout requisites are NOT part of registration (they are
    # entered per payout request), so activation requires phone, outlet and the
    # required number of network outlets — NOT payout_kind/payout_masked.
    merged = {
        "phone_e164": update_data.get("phone_e164", row.phone_e164),
        "outlet_name": update_data.get("outlet_name", row.outlet_name),
        "outlet_count": update_data.get("outlet_count", row.outlet_count),
    }
    if (
        row.status == SellerStatus.pending.value
        and merged["phone_e164"]
        and not merged["phone_e164"].startswith("+99")  # synthetic stub
        and merged["outlet_name"]
        and merged["outlet_count"] is not None
    ):
        update_data["status"] = SellerStatus.active.value

    if update_data:
        update_data["updated_by"] = telegram_id
        try:
            await session.execute(sa_update(Seller).where(Seller.telegram_id == telegram_id).values(**update_data))
            await session.commit()
        except IntegrityError as exc:
            # phone_e164 is UNIQUE — a seller registering with a number already
            # used by another account would otherwise surface as a raw 500.
            await session.rollback()
            if is_phone_conflict(exc):
                raise AppError("SELLER_PHONE_TAKEN", status_code=409) from exc
            raise AppError("VALIDATION_ERROR", status_code=409) from exc
        await session.refresh(row)

    return SellerRead.model_validate(row, from_attributes=True)


@router.post(
    "/tg-upsert",
    response_model=SellerRead,
    status_code=status.HTTP_200_OK,
    summary="Создать или обновить seller по telegram_id (требует Bearer-токен TMA)",
)
@limiter.limit("5/minute")
async def sellers_tg_upsert(
    request: Request,
    body: SellerTgUpsertRequest,
    repo: Annotated[SellerRepository, Depends(get_seller_repository)],
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SellerRead:
    # B2: token must belong to the same telegram_id as the request body.
    if token["user_id"] != body.id:
        raise AppError("AUTH_FORBIDDEN", status_code=403)

    async with session.begin():
        seller = await repo.ensure_seller(
            telegram_id=body.id,
            brand_id=body.brand_id,
            phone_e164=body.phone_e164,
            first_name=body.first_name,
            last_name=body.last_name,
        )

    return SellerRead.model_validate(seller, from_attributes=True)


# ---------------------------------------------------------------------------
# Admin CRUD placeholders
# ---------------------------------------------------------------------------


@router.post("", response_model=SellerRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_seller(payload: SellerCreate) -> SellerRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.get(
    "",
    response_model=PagedResponse[SellerRead],
    summary="Список продавцов (admin) с пагинацией и фильтрами (H25)",
)
async def list_sellers(  # noqa: PLR0913
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    # Admin-only — used to leak phone/payout PII across brands when gated on
    # plain `validate_token_dependency` (any seller token was accepted).
    token: Annotated[JwtTokenT, Depends(require_admin)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    sort: str = Query(default="created_at:desc"),
    brand_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    search: str | None = Query(default=None, description="Search by first_name, last_name, phone"),
    date_from: datetime | None = Query(default=None),  # noqa: B008
    date_to: datetime | None = Query(default=None),  # noqa: B008
) -> PagedResponse[SellerRead]:
    """H25: Paginated seller list for admin."""
    stmt = select(Seller)

    if brand_id is not None:
        stmt = stmt.where(Seller.brand_id == brand_id)
    if status is not None:
        stmt = stmt.where(Seller.status == status)
    if date_from is not None:
        stmt = stmt.where(Seller.created_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Seller.created_at <= date_to)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            or_(
                Seller.first_name.ilike(pattern),
                Seller.last_name.ilike(pattern),
                Seller.phone_e164.ilike(pattern),
            )
        )

    # Sorting.
    try:
        sort_field, sort_dir = sort.split(":", 1)
    except ValueError:
        sort_field, sort_dir = "created_at", "desc"

    _sort_map = {
        "created_at": Seller.created_at,
        "updated_at": Seller.updated_at,
    }
    sort_col = _sort_map.get(sort_field, Seller.created_at)
    stmt = stmt.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = stmt.offset((page - 1) * limit).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    items = [SellerRead.model_validate(r, from_attributes=True) for r in rows]
    return PagedResponse.build(items=items, total=total, page=page, limit=limit)


@router.get(
    "/{telegram_id}",
    response_model=SellerReadAdmin,
    summary="Получить продавца по telegram_id (admin)",
)
async def get_seller(
    telegram_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SellerReadAdmin:
    """Admin-only: fetch a single seller by telegram_id.

    Returns SellerReadAdmin which extends SellerRead with:
    - ``balance_available`` — spendable bonus balance (same formula as /sellers/me/balance).
    - ``receipts_total``   — total non-deleted receipt count for this seller.

    The list endpoint (GET /sellers) continues to use SellerRead to keep queries light.
    """
    row = (await session.execute(select(Seller).where(Seller.telegram_id == telegram_id))).scalar_one_or_none()
    if row is None:
        raise AppError("SELLER_NOT_FOUND", status_code=404)

    balance = await get_seller_balance(seller_id=telegram_id, session=session)

    receipts_total: int = (
        await session.execute(
            select(func.count(Receipt.id)).where(
                Receipt.seller_id == telegram_id,
                Receipt.is_deleted.is_(False),
            )
        )
    ).scalar_one()

    base = SellerRead.model_validate(row, from_attributes=True)
    return SellerReadAdmin(
        **base.model_dump(),
        balance_available=balance.available,
        receipts_total=receipts_total,
    )


@router.patch("/{telegram_id}", response_model=SellerRead)
async def update_seller(
    telegram_id: int,
    payload: SellerUpdate,
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SellerRead:
    """Update seller profile fields. Admins can update any seller; sellers can only update themselves."""
    if token.get("role") == "seller" and token["user_id"] != telegram_id:
        raise AppError("AUTH_FORBIDDEN", status_code=403)

    row = (await session.execute(select(Seller).where(Seller.telegram_id == telegram_id))).scalar_one_or_none()
    if row is None:
        raise AppError("SELLER_NOT_FOUND", status_code=404)

    # City must belong to the dictionary (source of truth = vliq.city / GET /cities).
    if payload.city is not None and not await city_name_is_valid(session, payload.city):
        raise AppError("SELLER_CITY_INVALID", status_code=400)

    update_data = payload.model_dump(exclude_none=True, exclude={"payout_account_raw"})

    # H7: Encrypt payout account if provided, generate masked version.
    if payload.payout_account_raw:
        cfg = get_config()
        if cfg.PAYOUT_ENCRYPTION_KEY:
            crypto = PayoutCrypto(cfg.PAYOUT_ENCRYPTION_KEY)
            update_data["payout_encrypted"] = crypto.encrypt(payload.payout_account_raw)
            update_data["payout_masked"] = "•••• " + payload.payout_account_raw[-4:]
        else:
            logger.warning("update_seller.no_encryption_key telegram_id=%s — payout_account_raw ignored", telegram_id)

    if update_data:
        update_data["updated_by"] = token["user_id"]
        try:
            await session.execute(sa_update(Seller).where(Seller.telegram_id == telegram_id).values(**update_data))
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            if is_phone_conflict(exc):
                raise AppError("SELLER_PHONE_TAKEN", status_code=409) from exc
            raise AppError("VALIDATION_ERROR", status_code=409) from exc
        await session.refresh(row)

    return SellerRead.model_validate(row, from_attributes=True)


@router.post(
    "/{telegram_id}/block",
    response_model=SellerRead,
    status_code=status.HTTP_200_OK,
    summary="Заблокировать продавца (admin) — T2",
)
async def block_seller(
    telegram_id: int,
    body: SellerBlockRequest,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SellerRead:
    """Block a seller: set status='blocked', record reason.

    Returns 404 if seller missing, 409 if already blocked.
    Enqueues a Telegram notification via outbox (same transaction).
    """
    async with session.begin():
        row = (
            await session.execute(
                select(Seller).where(Seller.telegram_id == telegram_id).with_for_update()
            )
        ).scalar_one_or_none()

        if row is None:
            raise AppError("SELLER_NOT_FOUND", status_code=404)

        if row.status == SellerStatus.blocked.value:
            raise AppError(
                "SELLER_ALREADY_BLOCKED",
                user_message="Продавец уже заблокирован.",
                status_code=409,
            )

        await session.execute(
            sa_update(Seller)
            .where(Seller.telegram_id == telegram_id)
            .values(
                status=SellerStatus.blocked.value,
                block_reason=body.reason,
                updated_by=token["user_id"],
            )
        )

        await notification_outbox.enqueue(
            session,
            recipient_id=telegram_id,
            channel="telegram",
            template="seller.blocked",
            payload={"reason": body.reason or ""},
        )

        session.add(
            AuditLog(
                actor_id=token["user_id"],
                actor_type="admin",
                action="block_seller",
                entity_type="seller",
                entity_id=telegram_id,
                comment=body.reason,
            )
        )

    await session.refresh(row)
    return SellerRead.model_validate(row, from_attributes=True)


@router.post(
    "/{telegram_id}/unblock",
    response_model=SellerRead,
    status_code=status.HTTP_200_OK,
    summary="Разблокировать продавца (admin) — T2",
)
async def unblock_seller(
    telegram_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> SellerRead:
    """Unblock a seller: set status='active', clear block_reason.

    Returns 404 if seller missing, 409 if not blocked.
    Enqueues a Telegram notification via outbox (same transaction).
    """
    async with session.begin():
        row = (
            await session.execute(
                select(Seller).where(Seller.telegram_id == telegram_id).with_for_update()
            )
        ).scalar_one_or_none()

        if row is None:
            raise AppError("SELLER_NOT_FOUND", status_code=404)

        if row.status != SellerStatus.blocked.value:
            raise AppError(
                "SELLER_NOT_BLOCKED",
                user_message="Продавец не заблокирован.",
                status_code=409,
            )

        await session.execute(
            sa_update(Seller)
            .where(Seller.telegram_id == telegram_id)
            .values(
                status=SellerStatus.active.value,
                block_reason=None,
                updated_by=token["user_id"],
            )
        )

        await notification_outbox.enqueue(
            session,
            recipient_id=telegram_id,
            channel="telegram",
            template="seller.unblocked",
            payload={},
        )

        session.add(
            AuditLog(
                actor_id=token["user_id"],
                actor_type="admin",
                action="unblock_seller",
                entity_type="seller",
                entity_id=telegram_id,
            )
        )

    await session.refresh(row)
    return SellerRead.model_validate(row, from_attributes=True)


@router.delete("/{telegram_id}", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def delete_seller(telegram_id: int) -> None:
    raise AppError("NOT_IMPLEMENTED", status_code=501)
