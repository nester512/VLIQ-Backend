"""Notification API router.

H23: POST /notifications/{id}/read — mark notification as read.
H25: Pagination on list endpoint.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.api.pagination import PagedResponse
from src.app.auth.jwt import JwtTokenT, validate_token_dependency
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.notification.models import Notification
from src.notification.schemas.api import (
    NotificationCreate,
    NotificationRead,
    NotificationUpdate,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.post(
    "/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Отметить уведомление как прочитанное (H23)",
)
async def mark_notification_read(
    notification_id: int,
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> None:
    notif = (
        await session.execute(select(Notification).where(Notification.id == notification_id).with_for_update())
    ).scalar_one_or_none()

    if notif is None:
        raise AppError("RECEIPT_NOT_FOUND", status_code=404)

    # Sellers can only mark their own notifications.
    if token.get("role") == "seller" and notif.seller_id != token["user_id"]:
        raise AppError("AUTH_FORBIDDEN", status_code=403)

    if notif.read_at is None:
        notif.read_at = datetime.now(tz=UTC)
        async with session.begin_nested():
            await session.flush()

    logger.info("notification.read notification_id=%s seller_id=%s", notification_id, notif.seller_id)


@router.post("", response_model=NotificationRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_notification(payload: NotificationCreate) -> NotificationRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.get(
    "",
    response_model=PagedResponse[NotificationRead],
    summary="Список уведомлений (H25)",
)
async def list_notifications(  # noqa: PLR0913
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    seller_id: int | None = Query(default=None, description="Filter by seller (admin)"),
    unread: bool | None = Query(default=None),
) -> PagedResponse[NotificationRead]:
    stmt = select(Notification)

    role = token.get("role")
    user_id = token.get("user_id")

    # Sellers see only their own notifications.
    if role == "seller":
        stmt = stmt.where(Notification.seller_id == user_id)
    elif seller_id is not None:
        stmt = stmt.where(Notification.seller_id == seller_id)

    if unread is True:
        stmt = stmt.where(Notification.read_at.is_(None))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(Notification.created_at.desc()).offset((page - 1) * limit).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    items = [NotificationRead.model_validate(r, from_attributes=True) for r in rows]
    return PagedResponse.build(items=items, total=total, page=page, limit=limit)


@router.get("/{notification_id}", response_model=NotificationRead)
async def get_notification(
    notification_id: int,
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> NotificationRead:
    notif = (await session.execute(select(Notification).where(Notification.id == notification_id))).scalar_one_or_none()

    if notif is None:
        raise AppError("RECEIPT_NOT_FOUND", status_code=404)

    if token.get("role") == "seller" and notif.seller_id != token["user_id"]:
        raise AppError("AUTH_FORBIDDEN", status_code=403)

    return NotificationRead.model_validate(notif, from_attributes=True)


@router.patch("/{notification_id}", response_model=NotificationRead, include_in_schema=False)
async def update_notification(notification_id: int, payload: NotificationUpdate) -> NotificationRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def delete_notification(notification_id: int) -> None:
    raise AppError("NOT_IMPLEMENTED", status_code=501)
