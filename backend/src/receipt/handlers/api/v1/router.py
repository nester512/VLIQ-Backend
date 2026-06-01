"""Receipt API endpoints.

H21: POST /receipts/upload — multipart file + brand_id → 202 or 409 duplicate
H22: POST /receipts/{id}/approve|reject|revise — admin state machine actions (H12)
H24: Schemas split into client-facing vs internal
H25: Pagination + filters on GET /receipts (admin queue)

All write endpoints that change status use the ReceiptStateMachine to validate
transitions before executing DB updates.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.api.pagination import PagedResponse
from src.app.auth.jwt import JwtTokenT, require_admin, require_seller, validate_token_dependency
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.audit_log.models import AuditLog
from src.bonus_transaction.models import BonusTransaction, BonusTransactionKind
from src.fraud.checks import FraudChecker
from src.notification import outbox as notification_outbox
from src.receipt.models import Receipt, ReceiptFileKind, ReceiptStatus
from src.receipt.schemas.api import (
    FinalizeUploadRequest,
    PresignedUploadRequest,
    PresignedUploadResponse,
    ReceiptCommentRequest,
    ReceiptCreate,
    ReceiptEditBonusRequest,
    ReceiptQrPayloadIn,
    ReceiptRead,
    ReceiptReviewAction,
    ReceiptStatusResponse,
    ReceiptUpdate,
    ReceiptUploadResponse,
)
from src.receipt_ocr.hasher import sha256_hash
from src.receipt_ocr.qr_parser import QRParseError, parse_qr_string
from src.receipt_ocr.storage import get_receipt_storage
from src.receipt_pipeline.state_machine import ReceiptStateMachine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/receipts", tags=["Receipt"])

_state_machine = ReceiptStateMachine()
_fraud_checker = FraudChecker()
_storage = get_receipt_storage()

# Allowed MIME types for upload.
_ALLOWED_MIME_TYPES = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
    }
)

# Map MIME → ReceiptFileKind.
_MIME_TO_KIND: dict[str, str] = {
    "image/jpeg": ReceiptFileKind.photo.value,
    "image/png": ReceiptFileKind.photo.value,
    "image/webp": ReceiptFileKind.photo.value,
    "application/pdf": ReceiptFileKind.pdf.value,
}


# ---------------------------------------------------------------------------
# H21: Upload receipt
# ---------------------------------------------------------------------------


@router.post(
    "/upload",
    response_model=ReceiptUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload receipt image (TMA)",
    description="Accept a receipt image, perform duplicate check, store file, enqueue processing.",
)
async def upload_receipt(
    request: Request,
    file: UploadFile,
    brand_id: Annotated[int, Form()],
    token: JwtTokenT = Depends(validate_token_dependency),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptUploadResponse:
    """Multipart receipt upload — main TMA client endpoint (H21)."""
    seller_id: int = token["user_id"]

    # Validate MIME type.
    content_type = file.content_type or ""
    if content_type not in _ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type: {content_type}. Allowed: jpeg, png, webp, pdf",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")

    # 1. Compute file hash (SHA-256).
    file_hash = sha256_hash(file_bytes)

    # 2. Duplicate check — before any DB insert.
    existing = await _fraud_checker.check_file_hash(session, file_hash)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": "duplicate_receipt",
                "existing_receipt_id": existing.id,
            },
        )

    # 3. Store file.
    file_url = await _storage.save(file_bytes, content_type, seller_id)

    # 4. INSERT receipt (status=pending).
    file_kind = _MIME_TO_KIND.get(content_type, ReceiptFileKind.photo.value)
    receipt = Receipt(
        seller_id=seller_id,
        brand_id=brand_id,
        status=ReceiptStatus.pending.value,
        file_kind=file_kind,
        file_url=file_url,
        file_hash=file_hash,
        items=[],
        fraud_signals=[],
        created_by=seller_id,
    )
    session.add(receipt)
    await session.flush()  # get receipt.id
    await session.commit()

    receipt_id = receipt.id

    # 5. Enqueue arq task (if arq pool is available in app.state).
    await _enqueue_processing(request, receipt_id)

    logger.info(
        "receipt.upload, receipt_id=%d, seller_id=%d, brand_id=%d, size=%d",
        receipt_id,
        seller_id,
        brand_id,
        len(file_bytes),
    )
    return ReceiptUploadResponse(receipt_id=receipt_id)


async def _enqueue_processing(request: Request, receipt_id: int) -> None:
    """Enqueue ``process_receipt_task`` via arq if pool is available."""
    pool = getattr(request.app.state, "arq_pool", None)
    if pool is not None:
        try:
            await pool.enqueue_job("process_receipt_task", receipt_id)
            logger.debug("receipt.enqueued, receipt_id=%d", receipt_id)
        except Exception as exc:
            logger.warning("receipt.enqueue_failed, receipt_id=%d: %s", receipt_id, exc)
    else:
        logger.warning("receipt.no_arq_pool, receipt_id=%d — worker not running?", receipt_id)


# ---------------------------------------------------------------------------
# T3: QR payload endpoint — from in-app Telegram QR scanner
# ---------------------------------------------------------------------------


@router.post(
    "/qr-payload",
    response_model=ReceiptUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit raw QR string scanned by Telegram in-app scanner (TMA)",
    description=(
        "Accepts a raw Russian fiscal QR string (``t=...&s=...&fn=...&i=...&fp=...&n=...``) "
        "directly instead of a file upload.  Parses the QR, creates a pending receipt, "
        "and enqueues processing — same flow as POST /receipts/upload but without a file."
    ),
    include_in_schema=True,
)
async def submit_qr_payload(
    request: Request,
    body: ReceiptQrPayloadIn,
    token: JwtTokenT = Depends(require_seller),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptUploadResponse:
    """Seller submits a raw QR string scanned by the Telegram in-app QR reader."""
    seller_id: int = token["user_id"]

    # Validate / parse the QR string before touching the DB.
    try:
        parsed = parse_qr_string(body.qr_raw)
    except QRParseError as exc:
        # TODO migrate to AppError (QR_PARSE_FAILED) once errors.py is published by parallel agent.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "QR_PARSE_FAILED", "message": str(exc)},
        ) from exc

    # Duplicate check on fn/fd/fp triple (same as pipeline fraud check, but early).
    existing = await _fraud_checker.check_fn_fd_fp(session, parsed.fn, parsed.fd, parsed.fp)
    if existing is not None and existing.seller_id == seller_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "DUPLICATE_RECEIPT",
                "existing_receipt_id": existing.id,
                "message": "QR already submitted",
            },
        )

    # Hash the QR string itself so the partial-unique `file_hash` constraint
    # both (a) prevents two empty-hash rows from colliding and (b) acts as a
    # natural dedupe for the same QR submitted twice (sha256(qr_raw) is stable).
    qr_hash = sha256_hash(body.qr_raw.encode("utf-8"))
    existing = await _fraud_checker.check_file_hash(session, qr_hash)
    if existing is not None:
        raise AppError("RECEIPT_DUPLICATE", status_code=409)

    # Create receipt row with qr_raw pre-filled; no file_url needed.
    receipt = Receipt(
        seller_id=seller_id,
        brand_id=body.brand_id,
        status=ReceiptStatus.pending.value,
        file_kind=ReceiptFileKind.qr.value,
        # file_url is required by the model — use a sentinel so it's not blank.
        file_url="qr://inline",
        file_hash=qr_hash,
        qr_raw=body.qr_raw,
        fn=parsed.fn,
        fd=parsed.fd,
        fp=parsed.fp,
        items=[],
        fraud_signals=[],
        created_by=seller_id,
    )
    session.add(receipt)
    await session.flush()
    await session.commit()

    receipt_id = receipt.id
    await _enqueue_processing(request, receipt_id)

    logger.info(
        "receipt.qr_payload, receipt_id=%d, seller_id=%d, brand_id=%d, fn=%s",
        receipt_id,
        seller_id,
        body.brand_id,
        parsed.fn,
    )
    return ReceiptUploadResponse(receipt_id=receipt_id)


# ---------------------------------------------------------------------------
# Presigned upload endpoints (direct-to-S3 flow)
# ---------------------------------------------------------------------------


@router.post(
    "/upload-url",
    response_model=PresignedUploadResponse,
    status_code=status.HTTP_200_OK,
    summary="Mint presigned S3 POST URL for direct browser-to-S3 upload (TMA)",
    description=(
        "Returns a short-lived presigned POST URL + form fields.  "
        "The browser POSTs the file directly to S3/MinIO, then calls "
        "POST /receipts/finalize with the returned storage_uri."
    ),
    include_in_schema=True,
)
async def get_upload_url(
    body: PresignedUploadRequest,
    token: JwtTokenT = Depends(require_seller),
) -> PresignedUploadResponse:
    """Mint a presigned S3 POST URL namespaced by the seller's telegram_id."""
    mime = body.mime.strip().lower()
    if mime not in _ALLOWED_MIME_TYPES:
        raise AppError("RECEIPT_UNSUPPORTED_TYPE", status_code=415)

    from src.receipt_ocr.storage import S3FileStorage  # noqa: PLC0415

    if not isinstance(_storage, S3FileStorage):
        raise AppError(
            "NOT_IMPLEMENTED",
            user_message="Presigned upload requires S3 storage backend.",
            status_code=501,
        )

    url, fields, storage_uri = await _storage.generate_presigned_post_url(
        mime=mime,
        telegram_id=token["user_id"],
        expires_in=600,
    )
    logger.info(
        "receipt.presigned_url_issued, seller_id=%d, mime=%s",
        token["user_id"],
        mime,
    )
    return PresignedUploadResponse(
        upload_url=url,
        fields=fields,
        storage_uri=storage_uri,
        expires_in=600,
    )


@router.post(
    "/finalize",
    response_model=ReceiptUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Finalize direct-to-S3 upload — read file from storage and enqueue processing (TMA)",
    description=(
        "After the browser has uploaded a file directly to S3 using the presigned POST URL "
        "from POST /receipts/upload-url, the TMA calls this endpoint with the storage_uri "
        "to create the receipt DB row and enqueue the OCR pipeline."
    ),
    include_in_schema=True,
)
async def finalize_upload(
    request: Request,
    body: FinalizeUploadRequest,
    token: JwtTokenT = Depends(require_seller),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptUploadResponse:
    """Read the already-uploaded file from S3, run duplicate check, create receipt row."""
    seller_id: int = token["user_id"]
    mime = body.mime.strip().lower()

    if mime not in _ALLOWED_MIME_TYPES:
        raise AppError("RECEIPT_UNSUPPORTED_TYPE", status_code=415)

    # Security: verify the URI is namespaced to this seller.
    # The presigned POST key format is: receipts/<telegram_id>/<uuid>.<ext>
    expected_prefix = f"receipts/{seller_id}/"
    # Strip the s3://<bucket>/ prefix to get the key.
    uri = body.storage_uri
    if not uri.startswith("s3://"):
        raise AppError("RECEIPT_NOT_YOURS", status_code=403)
    # Parse bucket and key from the URI.
    without_scheme = uri[len("s3://"):]
    slash = without_scheme.find("/")
    if slash == -1:
        raise AppError("RECEIPT_NOT_YOURS", status_code=403)
    key = without_scheme[slash + 1:]
    if not key.startswith(expected_prefix):
        raise AppError("RECEIPT_NOT_YOURS", status_code=403)

    # Read bytes from S3.
    try:
        file_bytes = await _storage.read(uri)
    except FileNotFoundError:
        raise AppError("RECEIPT_NOT_FOUND", status_code=404)

    if not file_bytes:
        raise AppError("RECEIPT_EMPTY_FILE", status_code=400)

    # Duplicate check via file hash.
    file_hash = sha256_hash(file_bytes)
    existing = await _fraud_checker.check_file_hash(session, file_hash)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": "duplicate_receipt",
                "existing_receipt_id": existing.id,
            },
        )

    # Insert receipt row.
    file_kind = _MIME_TO_KIND.get(mime, ReceiptFileKind.photo.value)
    receipt = Receipt(
        seller_id=seller_id,
        brand_id=body.brand_id,
        status=ReceiptStatus.pending.value,
        file_kind=file_kind,
        file_url=uri,
        file_hash=file_hash,
        items=[],
        fraud_signals=[],
        created_by=seller_id,
    )
    session.add(receipt)
    await session.flush()
    await session.commit()

    receipt_id = receipt.id
    await _enqueue_processing(request, receipt_id)

    logger.info(
        "receipt.finalize, receipt_id=%d, seller_id=%d, brand_id=%d, size=%d",
        receipt_id,
        seller_id,
        body.brand_id,
        len(file_bytes),
    )
    return ReceiptUploadResponse(receipt_id=receipt_id)


# ---------------------------------------------------------------------------
# Status polling endpoint
# ---------------------------------------------------------------------------


@router.get(
    "/{receipt_id}/status",
    response_model=ReceiptStatusResponse,
    summary="Poll receipt processing status (TMA)",
)
async def get_receipt_status(
    receipt_id: int,
    token: JwtTokenT = Depends(validate_token_dependency),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptStatusResponse:
    """Lightweight polling endpoint for the TMA to track processing progress."""
    seller_id: int = token["user_id"]
    receipt = await _get_receipt_or_404(session, receipt_id)

    # Sellers can only view their own receipts; admins see all.
    if token["role"] == "seller" and receipt.seller_id != seller_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your receipt")

    return ReceiptStatusResponse.model_validate(receipt)


# ---------------------------------------------------------------------------
# Admin review endpoints (H22 + H12)
# ---------------------------------------------------------------------------


@router.post(
    "/{receipt_id}/approve",
    status_code=status.HTTP_200_OK,
    summary="Approve receipt (admin) — atomic with bonus_transaction insert",
)
async def approve_receipt(  # noqa: PLR0913
    receipt_id: int,
    body: ReceiptReviewAction,
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
) -> dict:
    """Approve a receipt.

    Atomically:
    1. SELECT receipt FOR UPDATE (prevents concurrent modifications).
    2. Validate state machine transition: current_status → approved.
    3. UPDATE receipt status=approved.
    4. INSERT bonus_transaction(kind=accrual_receipt, amount=receipt.bonus_amount).
    5. INSERT notification_outbox row (same transaction — fault-tolerant delivery).
    6. INSERT audit_log record.

    H12: Steps 1-6 all in one ``async with session.begin()`` block.
    The outbox worker handles actual Telegram delivery with retries.
    """
    seller_id: int
    bonus_amount: int

    async with session.begin():
        receipt = await _get_receipt_for_update(session, receipt_id)
        _require_transition(receipt, ReceiptStatus.approved.value, "admin")

        seller_id = receipt.seller_id
        bonus_amount = receipt.bonus_amount or 0

        await session.execute(
            update(Receipt)
            .where(Receipt.id == receipt_id)
            .values(status=ReceiptStatus.approved.value, updated_by=token["user_id"])
        )

        # Insert bonus transaction only if bonus > 0.
        if bonus_amount > 0:
            bt = BonusTransaction(
                seller_id=receipt.seller_id,
                brand_id=receipt.brand_id,
                amount=bonus_amount,
                kind=BonusTransactionKind.accrual_receipt.value,
                source_type="receipt",
                source_id=receipt.id,
                reason=f"Receipt #{receipt_id} approved by admin {token['user_id']}",
                created_by=token["user_id"],
            )
            session.add(bt)

        # Enqueue Telegram notification via outbox — same transaction as status update.
        # The outbox worker delivers the message with retries; no risk of lost send on crash.
        # NOTE: in-app (Notification row) kept inline since it is already in the same
        # transaction and does not require external I/O — the outbox pattern is most
        # valuable for the external Telegram channel where network failures occur.
        await notification_outbox.enqueue(
            session,
            recipient_id=seller_id,
            channel="telegram",
            template="receipt.approved",
            payload={
                "receipt_id": receipt_id,
                "bonus_amount": bonus_amount,
                "available": bonus_amount,
            },
        )

        _insert_audit_log(
            session,
            actor_id=token["user_id"],
            actor_type="admin",
            action="approve_receipt",
            entity_type="receipt",
            entity_id=receipt_id,
            comment=body.comment,
        )

    logger.info("receipt.approved, receipt_id=%d, admin=%d, bonus=%d", receipt_id, token["user_id"], bonus_amount)
    return {"receipt_id": receipt_id, "status": ReceiptStatus.approved.value}


@router.post(
    "/{receipt_id}/reject",
    status_code=status.HTTP_200_OK,
    summary="Reject receipt (admin)",
)
async def reject_receipt(
    receipt_id: int,
    body: ReceiptReviewAction,
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
) -> dict:
    """Reject a receipt with an optional reason."""
    seller_id: int

    async with session.begin():
        receipt = await _get_receipt_for_update(session, receipt_id)
        _require_transition(receipt, ReceiptStatus.rejected.value, "admin")

        seller_id = receipt.seller_id

        await session.execute(
            update(Receipt)
            .where(Receipt.id == receipt_id)
            .values(
                status=ReceiptStatus.rejected.value,
                rejection_reason=body.comment,
                updated_by=token["user_id"],
            )
        )

        # Enqueue Telegram notification via outbox — same transaction.
        await notification_outbox.enqueue(
            session,
            recipient_id=seller_id,
            channel="telegram",
            template="receipt.rejected",
            payload={
                "receipt_id": receipt_id,
                "reason": body.comment or "Не указана",
            },
        )

        _insert_audit_log(
            session,
            actor_id=token["user_id"],
            actor_type="admin",
            action="reject_receipt",
            entity_type="receipt",
            entity_id=receipt_id,
            comment=body.comment,
        )

    logger.info("receipt.rejected, receipt_id=%d, admin=%d", receipt_id, token["user_id"])
    return {"receipt_id": receipt_id, "status": ReceiptStatus.rejected.value}


@router.post(
    "/{receipt_id}/revise",
    status_code=status.HTTP_200_OK,
    summary="Request revision from seller (admin)",
)
async def revise_receipt(
    receipt_id: int,
    body: ReceiptReviewAction,
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
) -> dict:
    """Move receipt to needs_revision — seller must re-upload or clarify."""
    async with session.begin():
        receipt = await _get_receipt_for_update(session, receipt_id)
        _require_transition(receipt, ReceiptStatus.needs_revision.value, "admin")

        await session.execute(
            update(Receipt)
            .where(Receipt.id == receipt_id)
            .values(
                status=ReceiptStatus.needs_revision.value,
                rejection_reason=body.comment,
                updated_by=token["user_id"],
            )
        )
        _insert_audit_log(
            session,
            actor_id=token["user_id"],
            actor_type="admin",
            action="revise_receipt",
            entity_type="receipt",
            entity_id=receipt_id,
            comment=body.comment,
        )

    logger.info("receipt.revision_requested, receipt_id=%d, admin=%d", receipt_id, token["user_id"])
    return {"receipt_id": receipt_id, "status": ReceiptStatus.needs_revision.value}


@router.post(
    "/{receipt_id}/retry",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Re-enqueue pipeline processing (admin)",
)
async def retry_receipt(
    receipt_id: int,
    request: Request,
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
) -> dict:
    """Re-queue processing for on_review or needs_revision receipts.

    Validates the state machine transition (any of these → ocr_in_progress),
    then enqueues a new arq job.
    """
    async with session.begin():
        receipt = await _get_receipt_for_update(session, receipt_id)
        _require_transition(receipt, "ocr_in_progress", "system")

        await session.execute(update(Receipt).where(Receipt.id == receipt_id).values(status="ocr_in_progress"))

    await _enqueue_processing(request, receipt_id)
    logger.info("receipt.retry_enqueued, receipt_id=%d, admin=%d", receipt_id, token["user_id"])
    return {"receipt_id": receipt_id, "status": "ocr_in_progress", "message": "Requeued for processing"}


# ---------------------------------------------------------------------------
# T3: PATCH /receipts/{id}/bonus — admin edits bonus amount
# ---------------------------------------------------------------------------


@router.patch(
    "/{receipt_id}/bonus",
    response_model=ReceiptRead,
    status_code=status.HTTP_200_OK,
    summary="Изменить сумму бонуса на чеке (admin) — T3",
)
async def edit_receipt_bonus(
    receipt_id: int,
    body: ReceiptEditBonusRequest,
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptRead:
    """Edit bonus_amount on a receipt.

    Valid only when receipt.status in ('on_review', 'approved').
    If already approved, inserts a correction BonusTransaction for the diff.
    Records before/after in audit_log payload.
    """
    _EDITABLE_STATUSES = {ReceiptStatus.on_review.value, ReceiptStatus.approved.value}

    async with session.begin():
        receipt = await _get_receipt_for_update(session, receipt_id)

        if receipt.status not in _EDITABLE_STATUSES:
            raise AppError("RECEIPT_INVALID_STATE_TRANSITION", status_code=409)

        old_bonus = receipt.bonus_amount or 0
        new_bonus = body.bonus_amount
        diff = new_bonus - old_bonus

        await session.execute(
            update(Receipt)
            .where(Receipt.id == receipt_id)
            .values(bonus_amount=new_bonus, updated_by=token["user_id"])
        )

        # If already approved, insert a correction transaction for the diff.
        if receipt.status == ReceiptStatus.approved.value and diff != 0:
            correction = BonusTransaction(
                seller_id=receipt.seller_id,
                brand_id=receipt.brand_id,
                amount=diff,
                kind=BonusTransactionKind.correction.value,
                source_type="receipt",
                source_id=receipt_id,
                reason=f"Bonus correction on receipt #{receipt_id} by admin {token['user_id']}: {old_bonus} → {new_bonus}",
                created_by=token["user_id"],
            )
            session.add(correction)

        log = AuditLog(
            actor_id=token["user_id"],
            actor_type="admin",
            action="edit_bonus",
            entity_type="receipt",
            entity_id=receipt_id,
            payload={"before": old_bonus, "after": new_bonus},
        )
        session.add(log)

    await session.refresh(receipt)
    logger.info(
        "receipt.bonus_edited, receipt_id=%d, admin=%d, before=%d, after=%d",
        receipt_id,
        token["user_id"],
        old_bonus,
        new_bonus,
    )
    return ReceiptRead.model_validate(receipt)


# ---------------------------------------------------------------------------
# T4: POST /receipts/{id}/comment — admin internal comment
# ---------------------------------------------------------------------------


@router.post(
    "/{receipt_id}/comment",
    response_model=ReceiptRead,
    status_code=status.HTTP_200_OK,
    summary="Добавить внутренний комментарий к чеку (admin) — T4",
)
async def add_receipt_comment(
    receipt_id: int,
    body: ReceiptCommentRequest,
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptRead:
    """Append an admin comment to receipt.admin_comments JSONB array.

    Comments are immutable once written; each entry records author, text, and timestamp.
    """
    from datetime import UTC, datetime  # noqa: PLC0415

    async with session.begin():
        receipt = await _get_receipt_for_update(session, receipt_id)

        existing: list = list(receipt.admin_comments or [])
        new_entry = {
            "author_telegram_id": token["user_id"],
            "text": body.text,
            "created_at": datetime.now(tz=UTC).isoformat(),
        }
        existing.append(new_entry)

        await session.execute(
            update(Receipt)
            .where(Receipt.id == receipt_id)
            .values(admin_comments=existing, updated_by=token["user_id"])
        )

        log = AuditLog(
            actor_id=token["user_id"],
            actor_type="admin",
            action="comment",
            entity_type="receipt",
            entity_id=receipt_id,
            comment=body.text,
        )
        session.add(log)

    await session.refresh(receipt)
    logger.info("receipt.comment_added, receipt_id=%d, admin=%d", receipt_id, token["user_id"])
    return ReceiptRead.model_validate(receipt)


# ---------------------------------------------------------------------------
# Existing CRUD stubs (kept for backward compatibility with v1 router)
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=ReceiptRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create receipt manually (admin/internal)",
)
async def create_receipt(
    payload: ReceiptCreate,
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptRead:
    """Admin-only manual receipt creation (internal use)."""
    receipt = Receipt(
        seller_id=payload.seller_id,
        brand_id=payload.brand_id,
        status=payload.status.value,
        bonus_amount=payload.bonus_amount,
        rejection_reason=payload.rejection_reason,
        file_kind=payload.file_kind.value,
        file_url=payload.file_url,
        file_hash=payload.file_hash,
        purchase_date=payload.purchase_date,
        total_sum=payload.total_sum,
        shop_name=payload.shop_name,
        shop_inn=payload.shop_inn,
        qr_raw=payload.qr_raw,
        fn=payload.fn,
        fd=payload.fd,
        fp=payload.fp,
        ocr_raw=payload.ocr_raw,
        items=[item.model_dump() for item in payload.items],
        fraud_signals=[sig.model_dump() for sig in payload.fraud_signals],
        created_by=token["user_id"],
    )
    session.add(receipt)
    await session.commit()
    await session.refresh(receipt)
    return ReceiptRead.model_validate(receipt)


@router.get(
    "",
    response_model=PagedResponse[ReceiptRead],
    summary="List receipts (admin) — paginated with filters (H25)",
)
async def list_receipts(  # noqa: PLR0913
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
    page: int = Query(default=1, ge=1, description="Page number (1-based)"),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="Comma-separated list of statuses, e.g. on_review,ocr_in_progress",
    ),
    seller_id: int | None = Query(default=None, description="Filter by seller telegram_id"),
    from_date: datetime | None = Query(default=None, alias="from", description="ISO date lower bound on created_at"),  # noqa: B008
    to_date: datetime | None = Query(default=None, alias="to", description="ISO date upper bound on created_at"),  # noqa: B008
) -> PagedResponse[ReceiptRead]:
    """Admin receipt queue with real pagination and server-side filters (H25).

    Filters:
    - ``status`` — comma-separated receipt statuses (e.g. ``on_review,ocr_in_progress``).
    - ``seller_id`` — integer seller telegram_id.
    - ``from`` / ``to`` — ISO-8601 datetime bounds on ``created_at``.

    Results are ordered by ``created_at DESC``.
    The total count reflects the filtered result set, not the unfiltered table.
    """
    stmt = select(Receipt).where(Receipt.is_deleted.is_(False))

    if status_filter is not None:
        statuses = [s.strip() for s in status_filter.split(",") if s.strip()]
        if statuses:
            stmt = stmt.where(Receipt.status.in_(statuses))

    if seller_id is not None:
        stmt = stmt.where(Receipt.seller_id == seller_id)

    if from_date is not None:
        stmt = stmt.where(Receipt.created_at >= from_date)

    if to_date is not None:
        stmt = stmt.where(Receipt.created_at <= to_date)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(Receipt.created_at.desc()).offset((page - 1) * limit).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    items = [ReceiptRead.model_validate(r, from_attributes=True) for r in rows]
    return PagedResponse.build(items=items, total=total, page=page, limit=limit)


@router.get(
    "/{receipt_id}",
    response_model=ReceiptRead,
    summary="Get receipt by ID (admin)",
)
async def get_receipt(
    receipt_id: int,
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptRead:
    receipt = await _get_receipt_or_404(session, receipt_id)
    return ReceiptRead.model_validate(receipt)


@router.patch(
    "/{receipt_id}",
    response_model=ReceiptRead,
    summary="Update receipt fields (admin/internal)",
)
async def update_receipt(
    receipt_id: int,
    payload: ReceiptUpdate,
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptRead:
    receipt = await _get_receipt_or_404(session, receipt_id)
    update_data = payload.model_dump(exclude_none=True)
    if update_data:
        update_data["updated_by"] = token["user_id"]
        await session.execute(update(Receipt).where(Receipt.id == receipt_id).values(**update_data))
        await session.commit()
        await session.refresh(receipt)
    return ReceiptRead.model_validate(receipt)


@router.delete(
    "/{receipt_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete receipt (admin)",
)
async def delete_receipt(
    receipt_id: int,
    token: JwtTokenT = Depends(require_admin),
    session: AsyncSession = Depends(get_pg_session),
) -> None:
    await _get_receipt_or_404(session, receipt_id)
    await session.execute(
        update(Receipt).where(Receipt.id == receipt_id).values(is_deleted=True, updated_by=token["user_id"])
    )
    await session.commit()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_receipt_or_404(session: AsyncSession, receipt_id: int) -> Receipt:
    result = await session.execute(select(Receipt).where(Receipt.id == receipt_id, Receipt.is_deleted.is_(False)))
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise AppError("RECEIPT_NOT_FOUND", status_code=404)
    return receipt


async def _get_receipt_for_update(session: AsyncSession, receipt_id: int) -> Receipt:
    """Load receipt with FOR UPDATE lock for atomic state transitions (H12)."""
    result = await session.execute(
        select(Receipt).where(Receipt.id == receipt_id, Receipt.is_deleted.is_(False)).with_for_update()
    )
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise AppError("RECEIPT_NOT_FOUND", status_code=404)
    return receipt


def _require_transition(receipt: Receipt, to_status: str, actor: str) -> None:
    """Raise 409 if the state machine does not allow this transition (T5)."""
    if not _state_machine.can_transition(from_status=receipt.status, to_status=to_status, actor=actor):
        raise AppError("RECEIPT_INVALID_STATE_TRANSITION", status_code=409)


def _insert_audit_log(  # noqa: PLR0913
    session: AsyncSession,
    *,
    actor_id: int,
    actor_type: str,
    action: str,
    entity_type: str,
    entity_id: int,
    comment: str | None,
) -> None:
    """Add an AuditLog row to the session (committed with surrounding begin())."""
    log = AuditLog(
        actor_id=actor_id,
        actor_type=actor_type,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        comment=comment,
    )
    session.add(log)
