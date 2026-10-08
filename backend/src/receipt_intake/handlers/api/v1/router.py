"""QR intake API: sellers submit dry fiscal data; admins see/force the OFD check.

docs/design/QR-INTAKE.md
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.auth.jwt import JwtTokenT, require_admin, require_seller
from src.app.depends import get_config, get_pg_session
from src.app.errors import AppError
from src.app.middleware.rate_limit import limiter
from src.app.settings import Settings
from src.receipt.models import Receipt, ReceiptStatus, ReceiptVerificationAttempt
from src.receipt.schemas.api import UploadWarning
from src.receipt.service import create_qr_receipt
from src.receipt_intake.fiscal import FiscalData, FiscalValidationError, validate_fields
from src.receipt_intake.schemas import (
    QrReceiptCreate,
    QrReceiptCreated,
    ReceiptVerificationRead,
    VerificationAttemptRead,
)
from src.receipt_verification.service import run_attempt
from src.receipt_verification.verifier import get_verifier
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
# Admin: verification history and forced re-check
# ---------------------------------------------------------------------------


async def _verification_read(session: AsyncSession, receipt_id: int) -> ReceiptVerificationRead:
    receipt = (await session.execute(select(Receipt).where(Receipt.id == receipt_id))).scalar_one_or_none()
    if receipt is None:
        raise AppError("RECEIPT_NOT_FOUND", status_code=404)
    attempts = (
        await session.execute(
            select(ReceiptVerificationAttempt)
            .where(ReceiptVerificationAttempt.receipt_id == receipt_id)
            .order_by(ReceiptVerificationAttempt.attempt_no.desc(), ReceiptVerificationAttempt.id.desc())
        )
    ).scalars().all()
    result = ReceiptVerificationRead(
        receipt_id=receipt.id,
        source=receipt.source,
        status=receipt.verification_status,
        attempts_count=receipt.verification_attempts,
        next_attempt_at=receipt.next_verification_at,
        verified_at=receipt.verified_at,
        ofd_response=receipt.ofd_response,
        attempts=[VerificationAttemptRead.model_validate(a, from_attributes=True) for a in attempts],
    )
    await session.commit()
    return result


@router.get(
    "/{receipt_id}/verification",
    response_model=ReceiptVerificationRead,
    summary="История проверки чека в ОФД (admin)",
)
async def get_verification(
    receipt_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> ReceiptVerificationRead:
    return await _verification_read(session, receipt_id)


@router.post(
    "/{receipt_id}/verify",
    response_model=ReceiptVerificationRead,
    summary="Проверить чек в ОФД сейчас (admin) — внеочередная попытка",
)
async def force_verification(
    receipt_id: int,
    token: Annotated[JwtTokenT, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    cfg: Annotated[Settings, Depends(get_config)],
) -> ReceiptVerificationRead:
    verifier = get_verifier(provider=cfg.OFD_PROVIDER, token=cfg.PROVERKACHEKA_TOKEN, timeout=cfg.OFD_TIMEOUT_SECONDS)
    result = await run_attempt(session, receipt_id, verifier, trigger="admin")
    if result is None:
        current = await _verification_read(session, receipt_id)  # 404 if missing
        if current.status == "not_required":
            raise AppError("RECEIPT_NOT_VERIFIABLE", status_code=409)
        raise AppError("VERIFICATION_IN_PROGRESS", status_code=409)
    return await _verification_read(session, receipt_id)
