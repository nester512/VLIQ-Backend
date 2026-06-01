"""Audit log API router.

H26: PATCH and DELETE return 405 — audit_log is append-only.
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
from src.app.auth.jwt import JwtTokenT, require_admin
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.audit_log.models import AuditLog
from src.audit_log.schemas.api import AuditLogCreate, AuditLogRead, AuditLogUpdate

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


@router.post("", response_model=AuditLogRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_audit_log(payload: AuditLogCreate) -> AuditLogRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.get(
    "",
    response_model=PagedResponse[AuditLogRead],
    summary="Список записей аудита (admin) с пагинацией и фильтрами (H25)",
)
async def list_audit_logs(  # noqa: PLR0913
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    actor_id: int | None = Query(default=None),
    actor_type: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: int | None = Query(default=None),
    action: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),  # noqa: B008
    date_to: datetime | None = Query(default=None),  # noqa: B008
) -> PagedResponse[AuditLogRead]:
    stmt = select(AuditLog)

    if actor_id is not None:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if actor_type is not None:
        stmt = stmt.where(AuditLog.actor_type == actor_type)
    if entity_type is not None:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if action is not None:
        stmt = stmt.where(AuditLog.action == action)
    if date_from is not None:
        stmt = stmt.where(AuditLog.created_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(AuditLog.created_at <= date_to)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(AuditLog.created_at.desc()).offset((page - 1) * limit).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    items = [AuditLogRead.model_validate(r, from_attributes=True) for r in rows]
    return PagedResponse.build(items=items, total=total, page=page, limit=limit)


@router.get("/{audit_log_id}", response_model=AuditLogRead)
async def get_audit_log(
    audit_log_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> AuditLogRead:
    row = (await session.execute(select(AuditLog).where(AuditLog.id == audit_log_id))).scalar_one_or_none()
    if row is None:
        raise AppError("RECEIPT_NOT_FOUND", status_code=404)
    return AuditLogRead.model_validate(row, from_attributes=True)


# H26: audit_log is append-only — PATCH and DELETE return 405 Method Not Allowed.


@router.patch(
    "/{audit_log_id}",
    status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
    summary="Not allowed — audit log is append-only (H26)",
    include_in_schema=True,
)
async def update_audit_log(audit_log_id: int, payload: AuditLogUpdate) -> Response:
    return Response(
        content='{"detail": "audit_log is append-only; PATCH is not allowed"}',
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        media_type="application/json",
    )


@router.delete(
    "/{audit_log_id}",
    status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
    summary="Not allowed — audit log is append-only (H26)",
    include_in_schema=True,
)
async def delete_audit_log(audit_log_id: int) -> Response:
    return Response(
        content='{"detail": "audit_log is append-only; DELETE is not allowed"}',
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        media_type="application/json",
    )
