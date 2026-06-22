"""Receipt package service — the single domain entry point for creating receipts.

Every receipt-ingest path (presigned ``/finalize``, multipart ``/upload``) funnels
through :func:`create_receipt_package`. There is intentionally **one** creation
algorithm: one seller submission → one Receipt with 1..5 ordered attachments + an
optional scanned QR, created atomically, idempotent by ``upload_idempotency_key``.

No duplicate check / 409 happens here — historical duplicates are surfaced later by
the pipeline as fraud *signals* (per spec S3/В-3), never as a hard ingest block.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.receipt.models import (
    MAX_ATTACHMENTS_PER_RECEIPT,
    AttachmentKind,
    Receipt,
    ReceiptAttachment,
    ReceiptFileKind,
    ReceiptStatus,
    attachment_kind_for_mime,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PreparedAttachment:
    """One attachment already persisted to storage, ready to be recorded.

    The transport layer (router) is responsible for validating the MIME/size,
    ensuring the bytes are in storage, and computing the hash/size — the service
    only records the aggregate atomically.
    """

    position: int
    storage_uri: str
    mime: str
    file_hash: str
    size_bytes: int


class PackageValidationError(ValueError):
    """Raised for a structurally invalid package (count / positions)."""


async def create_receipt_package(  # noqa: PLR0913
    session: AsyncSession,
    *,
    seller_id: int,
    brand_id: int,
    attachments: list[PreparedAttachment],
    scanned_qr: str | None = None,
    idempotency_key: str | None = None,
) -> tuple[Receipt, bool]:
    """Create one Receipt + N attachments atomically.

    Returns ``(receipt, created)``; ``created`` is ``False`` when an existing
    receipt was returned for a repeated ``idempotency_key`` (no new Receipt, no new
    pipeline job — the caller must not re-enqueue).

    Raises:
        PackageValidationError: count not in 1..5 or non-contiguous positions.
    """
    _validate_structure(attachments)

    ordered = sorted(attachments, key=lambda a: a.position)
    primary = ordered[0]
    primary_kind = attachment_kind_for_mime(primary.mime)

    receipt = Receipt(
        seller_id=seller_id,
        brand_id=brand_id,
        status=ReceiptStatus.pending.value,
        # Legacy single-file mirror of the primary attachment (backward-compat reads).
        file_kind=(ReceiptFileKind.pdf.value if primary_kind is AttachmentKind.pdf else ReceiptFileKind.photo.value),
        file_url=primary.storage_uri,
        file_hash=primary.file_hash,
        qr_raw=scanned_qr or None,
        upload_idempotency_key=idempotency_key,
        items=[],
        fraud_signals=[],
        created_by=seller_id,
        attachments=[
            ReceiptAttachment(
                position=a.position,
                kind=attachment_kind_for_mime(a.mime).value,
                mime_type=a.mime,
                storage_uri=a.storage_uri,
                file_hash=a.file_hash,
                size_bytes=a.size_bytes,
            )
            for a in ordered
        ],
    )

    # NB: `session.begin()` must be the FIRST operation on the session — the
    # FastAPI-provided session auto-begins a transaction on the first execute(),
    # so doing the idempotency SELECT *before* begin() would raise
    # "A transaction is already begun". So the lookup lives inside the transaction.
    try:
        async with session.begin():
            if idempotency_key:
                existing = await _find_by_idempotency_key(session, seller_id, idempotency_key)
                if existing is not None:
                    logger.info(
                        "receipt.package_idempotent_hit, receipt_id=%d, seller_id=%d", existing.id, seller_id
                    )
                    return existing, False
            session.add(receipt)
    except IntegrityError:
        # Concurrent finalize with the same idempotency key won the race — return
        # the winner instead of surfacing a constraint error.
        if idempotency_key:
            existing = await _find_by_idempotency_key(session, seller_id, idempotency_key)
            if existing is not None:
                logger.info(
                    "receipt.package_idempotent_race, receipt_id=%d, seller_id=%d", existing.id, seller_id
                )
                return existing, False
        raise

    await session.refresh(receipt)
    logger.info(
        "receipt.package_created, receipt_id=%d, seller_id=%d, brand_id=%d, attachments=%d, has_qr=%s",
        receipt.id,
        seller_id,
        brand_id,
        len(ordered),
        bool(scanned_qr),
    )
    return receipt, True


def _validate_structure(attachments: list[PreparedAttachment]) -> None:
    n = len(attachments)
    if n < 1:
        raise PackageValidationError("at least one attachment is required")
    if n > MAX_ATTACHMENTS_PER_RECEIPT:
        raise PackageValidationError(f"at most {MAX_ATTACHMENTS_PER_RECEIPT} attachments are allowed")
    positions = [a.position for a in attachments]
    if len(set(positions)) != n:
        raise PackageValidationError("attachment positions must be unique")
    if sorted(positions) != list(range(n)):
        raise PackageValidationError(f"attachment positions must be 0..{n - 1} with no gaps")


async def _find_by_idempotency_key(session: AsyncSession, seller_id: int, key: str) -> Receipt | None:
    result = await session.execute(
        select(Receipt).where(
            Receipt.seller_id == seller_id,
            Receipt.upload_idempotency_key == key,
            Receipt.is_deleted.is_(False),
        )
    )
    return result.scalar_one_or_none()
