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
from src.notification import outbox as notification_outbox
from src.receipt.models import (
    ALLOWED_ATTACHMENT_MIME_TYPES,
    MAX_ATTACHMENT_SIZE_BYTES,
    MAX_ATTACHMENTS_PER_RECEIPT,
    Receipt,
    ReceiptStatus,
)
from src.receipt.schemas.api import (
    PackageFinalizeRequest,
    PackageUploadSlot,
    PackageUploadUrlsRequest,
    PackageUploadUrlsResponse,
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
from src.receipt.service import PackageValidationError, PreparedAttachment, create_receipt_package
from src.receipt.upload_session import UploadSessionError, sign_upload_session, verify_upload_session
from src.receipt_ocr.hasher import sha256_hash
from src.receipt_ocr.storage import get_receipt_storage, to_viewable_url
from src.receipt_pipeline.state_machine import ReceiptStateMachine
from src.seller.models import Seller

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/receipts", tags=["Receipt"])

_state_machine = ReceiptStateMachine()
_storage = get_receipt_storage()


# ---------------------------------------------------------------------------
# H21: Upload receipt
# ---------------------------------------------------------------------------


@router.post(
    "/upload",
    response_model=ReceiptUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a receipt package — 1..5 files + optional scanned QR (TMA)",
    description=(
        "Multipart batch upload: one submission → one Receipt with 1..5 attachments "
        "(images and/or PDFs), optionally enriched by a scanned QR string. Files are "
        "stored server-side; the receipt is created atomically and processed once. "
        "This is the no-S3 / dev fallback for the presigned upload-urls + finalize flow."
    ),
)
async def upload_receipt(  # noqa: PLR0913
    request: Request,
    files: list[UploadFile],
    brand_id: Annotated[int, Form()],
    scanned_qr: Annotated[str | None, Form()] = None,
    idempotency_key: Annotated[str | None, Form()] = None,
    token: JwtTokenT = Depends(validate_token_dependency),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptUploadResponse:
    """Multipart batch receipt upload — main TMA client fallback path (H21).

    No hard 409 on duplicate file hash anymore: a repeated file becomes a fraud
    *signal* for the admin during pipeline processing (spec S3/В-3).
    """
    seller_id: int = token["user_id"]

    if not files:
        raise AppError("RECEIPT_NO_FILES", status_code=400, user_message="Приложите хотя бы один файл.")
    if len(files) > MAX_ATTACHMENTS_PER_RECEIPT:
        raise AppError("RECEIPT_TOO_MANY_FILES", status_code=400)

    prepared: list[PreparedAttachment] = []
    for position, file in enumerate(files):
        mime = (file.content_type or "").split(";")[0].strip().lower()
        _validate_attachment_mime(mime)
        data = await file.read()
        if not data:
            raise AppError("RECEIPT_EMPTY_FILE", status_code=400)
        if len(data) > MAX_ATTACHMENT_SIZE_BYTES:
            raise AppError("RECEIPT_FILE_TOO_LARGE", status_code=413)
        storage_uri = await _storage.save(data, mime, seller_id)
        prepared.append(
            PreparedAttachment(
                position=position,
                storage_uri=storage_uri,
                mime=mime,
                file_hash=sha256_hash(data),
                size_bytes=len(data),
            )
        )

    receipt, created = await _create_package_or_raise(
        session,
        seller_id=seller_id,
        brand_id=brand_id,
        attachments=prepared,
        scanned_qr=scanned_qr,
        idempotency_key=idempotency_key,
    )

    if created:
        await _enqueue_processing(request, receipt.id)
    logger.info(
        "receipt.upload_package, receipt_id=%d, seller_id=%d, brand_id=%d, files=%d, created=%s",
        receipt.id,
        seller_id,
        brand_id,
        len(prepared),
        created,
    )
    return ReceiptUploadResponse(receipt_id=receipt.id)


def _validate_attachment_mime(mime: str) -> None:
    """Reject unsupported MIME types (server-validated — client MIME is untrusted)."""
    if mime not in ALLOWED_ATTACHMENT_MIME_TYPES:
        raise AppError("RECEIPT_UNSUPPORTED_TYPE", status_code=415)


async def _create_package_or_raise(  # noqa: PLR0913
    session: AsyncSession,
    *,
    seller_id: int,
    brand_id: int,
    attachments: list[PreparedAttachment],
    scanned_qr: str | None,
    idempotency_key: str | None,
) -> tuple[Receipt, bool]:
    """Call the package service, translating structural errors to AppError."""
    try:
        return await create_receipt_package(
            session,
            seller_id=seller_id,
            brand_id=brand_id,
            attachments=attachments,
            scanned_qr=scanned_qr,
            idempotency_key=idempotency_key,
        )
    except PackageValidationError as exc:
        raise AppError("RECEIPT_INVALID_PACKAGE", status_code=400, extra={"reason": str(exc)}) from exc


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
    status_code=status.HTTP_400_BAD_REQUEST,
    summary="[DEPRECATED] QR-only submission removed — attach files instead (TMA)",
    description=(
        "**Deprecated.** Standalone QR submission was removed per spec S3 (В-2-A): a scanned "
        "QR may only accompany at least one photo/PDF. New submissions must use POST /receipts/upload "
        "(multipart batch) or the presigned upload-urls + finalize flow, passing the scanned QR as "
        "the optional ``scanned_qr`` field. Old QR-only receipts remain readable."
    ),
    deprecated=True,
    include_in_schema=True,
)
async def submit_qr_payload(
    body: ReceiptQrPayloadIn,
    token: JwtTokenT = Depends(require_seller),
) -> None:
    """Removed endpoint — QR-only submissions are no longer accepted."""
    raise AppError(
        "QR_ONLY_DEPRECATED",
        status_code=400,
        user_message="Отсканированный QR можно приложить только вместе с фото или PDF.",
    )


# ---------------------------------------------------------------------------
# Presigned package upload (direct-to-S3) — upload-urls + finalize
# ---------------------------------------------------------------------------


@router.post(
    "/upload-urls",
    response_model=PackageUploadUrlsResponse,
    status_code=status.HTTP_200_OK,
    summary="Mint 1..5 presigned S3 POST URLs for a receipt package (TMA)",
    description=(
        "Returns one short-lived presigned POST slot per file (1..5) plus a signed "
        "``upload_session`` token binding the issued storage keys to this seller. The "
        "browser POSTs each file directly to S3/MinIO, then calls POST /receipts/finalize "
        "with the session token and the attachment list. Requires an S3 storage backend "
        "(501 otherwise → the client falls back to multipart POST /receipts/upload)."
    ),
)
async def get_upload_urls(
    body: PackageUploadUrlsRequest,
    token: JwtTokenT = Depends(require_seller),
) -> PackageUploadUrlsResponse:
    """Mint presigned POST slots for a 1..5 file package, namespaced by the seller."""
    seller_id: int = token["user_id"]

    from src.receipt_ocr.storage import S3FileStorage  # noqa: PLC0415

    if not isinstance(_storage, S3FileStorage):
        raise AppError(
            "NOT_IMPLEMENTED",
            user_message="Presigned upload requires S3 storage backend.",
            status_code=501,
        )

    slots: list[PackageUploadSlot] = []
    issued_keys: list[str] = []
    for position, meta in enumerate(body.files):
        mime = meta.mime.strip().lower()
        _validate_attachment_mime(mime)
        if meta.size > MAX_ATTACHMENT_SIZE_BYTES:
            raise AppError("RECEIPT_FILE_TOO_LARGE", status_code=413)
        url, fields, storage_uri = await _storage.generate_presigned_post_url(
            mime=mime,
            telegram_id=seller_id,
            expires_in=600,
        )
        issued_keys.append(storage_uri)
        slots.append(
            PackageUploadSlot(
                client_id=meta.client_id,
                position=position,
                upload_url=url,
                fields=fields,
                storage_uri=storage_uri,
            )
        )

    session_token = sign_upload_session(seller_id=seller_id, keys=issued_keys)
    logger.info("receipt.presigned_urls_issued, seller_id=%d, files=%d", seller_id, len(slots))
    return PackageUploadUrlsResponse(upload_session=session_token, files=slots, expires_in=600)


@router.post(
    "/upload-url",
    response_model=PresignedUploadResponse,
    status_code=status.HTTP_200_OK,
    summary="[DEPRECATED] Mint a single presigned S3 POST URL — use /upload-urls",
    description="Deprecated single-file presigned URL. Use POST /receipts/upload-urls for the package flow.",
    deprecated=True,
)
async def get_upload_url(
    body: PresignedUploadRequest,
    token: JwtTokenT = Depends(require_seller),
) -> PresignedUploadResponse:
    """Deprecated single-file presigned POST URL (kept for backward compatibility)."""
    mime = body.mime.strip().lower()
    _validate_attachment_mime(mime)

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
    return PresignedUploadResponse(upload_url=url, fields=fields, storage_uri=storage_uri, expires_in=600)


@router.post(
    "/finalize",
    response_model=ReceiptUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Finalize a presigned receipt package — create one Receipt + N attachments (TMA)",
    description=(
        "After the browser uploaded 1..5 files directly to S3 using the slots from "
        "POST /receipts/upload-urls, this creates one Receipt with N attachments and enqueues "
        "processing once. Idempotent by ``idempotency_key`` — a retried finalize returns the "
        "same receipt. The optional ``scanned_qr`` is an additional fiscal-identity candidate."
    ),
)
async def finalize_upload(
    request: Request,
    body: PackageFinalizeRequest,
    token: JwtTokenT = Depends(require_seller),
    session: AsyncSession = Depends(get_pg_session),
) -> ReceiptUploadResponse:
    """Verify the upload session, read each object from storage, create the package."""
    seller_id: int = token["user_id"]

    # 1. Verify the signed session binds these storage keys to this seller.
    try:
        granted_keys = set(verify_upload_session(body.upload_session, seller_id=seller_id))
    except UploadSessionError as exc:
        raise AppError("RECEIPT_UPLOAD_SESSION_INVALID", status_code=403, extra={"reason": str(exc)}) from exc

    # 2. Build prepared attachments — validate MIME, ownership, existence; hash/size.
    prepared: list[PreparedAttachment] = []
    for att in body.attachments:
        mime = att.mime.strip().lower()
        _validate_attachment_mime(mime)
        if att.storage_uri not in granted_keys:
            # The client may not finalize a key it was never granted (anti key-swap).
            raise AppError("RECEIPT_NOT_YOURS", status_code=403)
        try:
            file_bytes = await _storage.read(att.storage_uri)
        except FileNotFoundError:
            raise AppError("RECEIPT_NOT_FOUND", status_code=404) from None
        if not file_bytes:
            raise AppError("RECEIPT_EMPTY_FILE", status_code=400)
        if len(file_bytes) > MAX_ATTACHMENT_SIZE_BYTES:
            raise AppError("RECEIPT_FILE_TOO_LARGE", status_code=413)
        prepared.append(
            PreparedAttachment(
                position=att.position,
                storage_uri=att.storage_uri,
                mime=mime,
                file_hash=sha256_hash(file_bytes),
                size_bytes=len(file_bytes),
            )
        )

    receipt, created = await _create_package_or_raise(
        session,
        seller_id=seller_id,
        brand_id=body.brand_id,
        attachments=prepared,
        scanned_qr=body.scanned_qr,
        idempotency_key=body.idempotency_key,
    )

    if created:
        await _enqueue_processing(request, receipt.id)
    logger.info(
        "receipt.finalize_package, receipt_id=%d, seller_id=%d, attachments=%d, created=%s",
        receipt.id,
        seller_id,
        len(prepared),
        created,
    )
    return ReceiptUploadResponse(receipt_id=receipt.id)


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

    resp = ReceiptStatusResponse.model_validate(receipt)
    resp.file_url = to_viewable_url(receipt.file_url)
    return resp


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
    """Stub: revise action rejects the receipt (needs_revision flow not yet implemented)."""
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

        await notification_outbox.enqueue(
            session,
            recipient_id=seller_id,
            channel="telegram",
            template="receipt.rejected",
            payload={
                "receipt_id": receipt_id,
                "reason": body.comment or "Чек отклонён",
            },
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

    logger.info("receipt.revise_as_rejected, receipt_id=%d, admin=%d", receipt_id, token["user_id"])
    return {"receipt_id": receipt_id, "status": ReceiptStatus.rejected.value}


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

    logger.info(
        "receipt.bonus_edited, receipt_id=%d, admin=%d, before=%d, after=%d",
        receipt_id,
        token["user_id"],
        old_bonus,
        new_bonus,
    )
    return await _build_receipt_read(session, receipt_id)


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

    logger.info("receipt.comment_added, receipt_id=%d, admin=%d", receipt_id, token["user_id"])
    return await _build_receipt_read(session, receipt_id)


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
    await session.flush()
    new_id = receipt.id
    await session.commit()
    return await _build_receipt_read(session, new_id)


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

    items = []
    for r in rows:
        item = ReceiptRead.model_validate(r, from_attributes=True)
        # Expose a browser-viewable photo URL so the admin review deck can show it.
        item.file_url = to_viewable_url(r.file_url) or r.file_url
        items.append(item)
    await _attach_seller_info(session, items)
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
    read = ReceiptRead.model_validate(receipt)
    read.file_url = to_viewable_url(receipt.file_url) or receipt.file_url
    await _attach_seller_info(session, [read])
    return read


async def _attach_seller_info(session: AsyncSession, items: list[ReceiptRead]) -> None:
    """Batch-fill seller_name + seller_store on admin receipt DTOs so the review
    card shows the real name/store (joined from the seller table)."""
    seller_ids = {it.seller_id for it in items}
    if not seller_ids:
        return
    rows = (await session.execute(select(Seller).where(Seller.telegram_id.in_(seller_ids)))).scalars().all()
    by_id = {s.telegram_id: s for s in rows}
    for it in items:
        s = by_id.get(it.seller_id)
        if s is None:
            continue
        name = " ".join(p for p in (s.first_name, s.last_name) if p).strip()
        it.seller_name = name or None
        it.seller_store = s.outlet_name or None


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
    await _get_receipt_or_404(session, receipt_id)  # 404 if missing/deleted
    update_data = payload.model_dump(exclude_none=True)
    if update_data:
        update_data["updated_by"] = token["user_id"]
        # dict positionally — `.values(**update_data)` breaks on the `fn` column.
        await session.execute(update(Receipt).where(Receipt.id == receipt_id).values(update_data))
        await session.commit()
    return await _build_receipt_read(session, receipt_id)


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


async def _build_receipt_read(session: AsyncSession, receipt_id: int) -> ReceiptRead:
    """Re-select the receipt (selectin eager-loads attachments) and build the admin DTO.

    Write endpoints mutate via UPDATE/INSERT then need a fresh DTO. A plain
    ``session.refresh()`` expires the selectin relationship, which would then
    lazy-load ``attachments`` in a sync context (illegal under async) — so we
    re-select instead, which loads attachments eagerly via selectin.
    """
    receipt = await _get_receipt_or_404(session, receipt_id)
    read = ReceiptRead.model_validate(receipt)
    read.file_url = to_viewable_url(receipt.file_url) or receipt.file_url
    return read


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
