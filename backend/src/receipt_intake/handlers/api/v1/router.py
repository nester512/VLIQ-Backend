"""QR intake API: sellers submit dry fiscal data; admins see/force the OFD check.

docs/design/QR-INTAKE.md
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.auth.jwt import JwtTokenT, require_admin, require_seller, require_super_admin
from src.app.depends import get_config, get_pg_session
from src.app.errors import AppError
from src.app.middleware.rate_limit import limiter
from src.app.settings import Settings
from src.receipt.models import CheckProvider, EventKind, Receipt, ReceiptStatus, ReceiptVerificationAttempt
from src.receipt.schemas.api import UploadWarning
from src.receipt.service import create_qr_receipt
from src.receipt_intake.fiscal import FiscalData, FiscalValidationError, validate_fields
from src.receipt_intake.schemas import (
    CheckRead,
    JourneyEventRead,
    JourneySummary,
    ProviderRead,
    ProviderUpdate,
    QrReceiptCreate,
    QrReceiptCreated,
    ReceiptJourneyRead,
    VerifyRequest,
)
from src.receipt_journey import service as journey
from src.receipt_verification.providers import ProviderRegistry
from src.receipt_verification.service import run_round
from src.seller.depends import forbid_blocked_seller

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/receipts", tags=["Receipts · QR intake"])

QR_JOB = "process_qr_receipt_task"


@router.post(
    "/qr",
    dependencies=[Depends(forbid_blocked_seller)],
    response_model=QrReceiptCreated,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Отправить чек данными из QR (сканер / камера / фото / ручной ввод)",
    description=(
        "Принимает только сухие фискальные данные чека. Валидация строгая (422 с кодом поля), "
        "дубль по ФН+ФД+ФП — предупреждение POSSIBLE_DUPLICATE, не блокировка. "
        "Чек уходит на модерацию, параллельно запускается проверка в ОФД."
    ),
)
@limiter.limit("20/minute")
async def submit_qr_receipt(
    request: Request,
    body: QrReceiptCreate,
    token: Annotated[JwtTokenT, Depends(require_seller)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> QrReceiptCreated:
    seller_id: int = token["user_id"]
    try:
        data = validate_fields(fn=body.fn, fd=body.fd, fp=body.fp, t=body.t, s=body.s, n=body.n)
    except FiscalValidationError as exc:
        raise AppError(exc.code, user_message=exc.message, status_code=422, extra={"field": exc.field}) from exc

    receipt, created = await create_qr_receipt(
        session, seller_id=seller_id, brand_id=body.brand_id, data=data, source=body.source,
        idempotency_key=body.idempotency_key,
    )
    # A repeated key for a still-pending receipt re-enqueues safely (the job id dedupes).
    needs_job = created or receipt.status == ReceiptStatus.pending.value
    if needs_job and not await _enqueue(request, receipt.id):
        await _fallback_to_review(session, receipt.id)
    return QrReceiptCreated(receipt_id=receipt.id, status=receipt.status, warnings=await _warnings(session, receipt.id, data))


async def _enqueue(request: Request, receipt_id: int) -> bool:
    pool = getattr(request.app.state, "arq_pool", None)
    if pool is None:
        logger.warning("qr_intake.no_arq_pool, receipt_id=%d", receipt_id)
        return False
    try:
        await pool.enqueue_job(QR_JOB, receipt_id, _job_id=f"receipt-qr-{receipt_id}")
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("qr_intake.enqueue_failed, receipt_id=%d: %s", receipt_id, exc)
        return False


async def _fallback_to_review(session: AsyncSession, receipt_id: int) -> None:
    """No worker job → straight to moderation; the verification stays armed for the cron."""
    from datetime import UTC, datetime  # noqa: PLC0415

    signal = {
        "signal": "pipeline_enqueue_failed",
        "severity": "high",
        "details": "Не удалось поставить чек в очередь обработки — проверка в ОФД пройдёт по расписанию.",
    }
    async with session.begin():
        await session.execute(
            update(Receipt)
            .where(Receipt.id == receipt_id, Receipt.status == ReceiptStatus.pending.value)
            .values(status=ReceiptStatus.on_review.value, fraud_signals=[signal], next_verification_at=datetime.now(UTC))
        )


async def _warnings(session: AsyncSession, receipt_id: int, data: FiscalData) -> list[UploadWarning]:
    warnings: list[UploadWarning] = []
    dup = (
        await session.execute(
            select(Receipt.id)
            .where(
                Receipt.fn == data.fn, Receipt.fd == data.fd, Receipt.fp == data.fp,
                Receipt.id != receipt_id, Receipt.is_deleted.is_(False),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    await session.commit()
    if dup is not None:
        warnings.append(UploadWarning(
            code="POSSIBLE_DUPLICATE",
            message="Этот чек уже загружался ранее. Он отправлен на проверку — решение примет администратор.",
        ))
    if data.is_too_old:
        warnings.append(UploadWarning(
            code="RECEIPT_TOO_OLD",
            message="Чеку больше 30 дней — по условиям программы он может быть отклонён.",
        ))
    return warnings


# ---------------------------------------------------------------------------
# Admin: receipt journey, checks, provider registry
# ---------------------------------------------------------------------------

_DECISIONS = (EventKind.approved.value, EventKind.rejected.value, EventKind.sent_to_revision.value)


def get_registry(cfg: Annotated[Settings, Depends(get_config)]) -> ProviderRegistry:
    return ProviderRegistry.from_settings(
        provider=cfg.OFD_PROVIDER, token=cfg.PROVERKACHEKA_TOKEN, stub=cfg.CHECK_PROVIDER_STUB,
        timeout=cfg.OFD_TIMEOUT_SECONDS,
    )


async def _providers(session: AsyncSession, registry: ProviderRegistry) -> list[ProviderRead]:
    return [
        ProviderRead(
            code=p.code, title=p.title, role=p.role, priority=p.priority, enabled=p.enabled,
            available=registry.is_available(p.code), disabled_until=p.disabled_until,
            consecutive_failures=p.consecutive_failures,
        )
        for p in await registry.rows(session)
    ]


async def _journey_read(session: AsyncSession, receipt_id: int, registry: ProviderRegistry) -> ReceiptJourneyRead:
    receipt = (await session.execute(select(Receipt).where(Receipt.id == receipt_id))).scalar_one_or_none()
    if receipt is None:
        raise AppError("RECEIPT_NOT_FOUND", status_code=404)
    events = await journey.events_of(session, receipt_id)
    check_ids = [e.check_id for e in events if e.check_id]
    checks = {
        c.id: CheckRead.model_validate(c, from_attributes=True)
        for c in (
            await session.execute(select(ReceiptVerificationAttempt).where(ReceiptVerificationAttempt.id.in_(check_ids)))
        ).scalars()
    } if check_ids else {}
    received = next((e for e in events if e.kind == EventKind.received.value), None)
    decision = next((e for e in reversed(events) if e.kind in _DECISIONS), None)
    result = ReceiptJourneyRead(
        receipt_id=receipt.id,
        summary=JourneySummary(
            received_at=received.at if received else receipt.created_at,
            intake_source=(received.source if received else None) or receipt.source,
            status=receipt.status,
            verification_status=receipt.verification_status,
            verified_by=receipt.verified_by,
            verified_at=receipt.verified_at,
            check_rounds=receipt.check_rounds,
            next_check_at=receipt.next_verification_at,
            decision=decision.kind if decision else None,
            decided_at=decision.at if decision else None,
            decided_by=decision.actor_id if decision else None,
        ),
        events=[
            JourneyEventRead(
                seq=e.seq, at=e.at, kind=e.kind, actor_type=e.actor_type, actor_id=e.actor_id, source=e.source,
                outcome=e.outcome, data=e.data, check=checks.get(e.check_id) if e.check_id else None,
            )
            for e in events
        ],
        providers=await _providers(session, registry),
    )
    await session.commit()
    return result


@router.get("/{receipt_id}/journey", response_model=ReceiptJourneyRead, summary="Путь чека: все шаги, проверки и решения (admin)")
async def get_journey(
    receipt_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    registry: Annotated[ProviderRegistry, Depends(get_registry)],
) -> ReceiptJourneyRead:
    return await _journey_read(session, receipt_id, registry)


@router.post(
    "/{receipt_id}/verify",
    response_model=ReceiptJourneyRead,
    summary="Проверить чек сейчас (admin): полный раунд или один выбранный источник",
)
async def force_verification(
    receipt_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    registry: Annotated[ProviderRegistry, Depends(get_registry)],
    body: VerifyRequest | None = None,
) -> ReceiptJourneyRead:
    provider = body.provider if body else None
    if provider is not None and not registry.is_available(provider):
        raise AppError("CHECK_PROVIDER_UNAVAILABLE", status_code=409)
    result = await run_round(
        session, receipt_id, registry, trigger="admin", actor_id=token["user_id"], only_provider=provider
    )
    if result is None:
        current = await _journey_read(session, receipt_id, registry)  # 404 if missing
        if current.summary.verification_status == "not_required":
            raise AppError("RECEIPT_NOT_VERIFIABLE", status_code=409)
        raise AppError("VERIFICATION_IN_PROGRESS", status_code=409)
    return await _journey_read(session, receipt_id, registry)


providers_router = APIRouter(prefix="/check-providers", tags=["Receipts · QR intake"])


@providers_router.get("", response_model=list[ProviderRead], summary="Источники проверки чеков: порядок, вкл/выкл, подключён ли")
async def list_providers(
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    registry: Annotated[ProviderRegistry, Depends(get_registry)],
) -> list[ProviderRead]:
    result = await _providers(session, registry)
    await session.commit()
    return result


@providers_router.patch("/{code}", response_model=list[ProviderRead], summary="Включить/выключить источник, поменять порядок (super_admin)")
async def update_provider(
    code: str,
    body: ProviderUpdate,
    token: Annotated[JwtTokenT, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    registry: Annotated[ProviderRegistry, Depends(get_registry)],
) -> list[ProviderRead]:
    from datetime import UTC, datetime  # noqa: PLC0415

    values = body.model_dump(exclude_none=True)
    async with session.begin():
        row = (await session.execute(select(CheckProvider).where(CheckProvider.code == code).with_for_update())).scalar_one_or_none()
        if row is None:
            raise AppError("CHECK_PROVIDER_NOT_FOUND", status_code=404)
        for key, value in values.items():
            setattr(row, key, value)
        row.updated_at = datetime.now(UTC)
    logger.info("check_provider.updated, code=%s, by=%s, changes=%s", code, token["user_id"], values)
    return await list_providers(token, session, registry)
