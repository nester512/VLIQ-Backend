"""Receipt API schemas.

Public API schemas (used by TMA clients):
    ReceiptUploadResponse — 202 response from POST /receipts/upload
    ReceiptStatusResponse  — GET /receipts/{id}/status polling response
    ReceiptReviewAction    — body for admin approve/reject/revise endpoints

Internal schemas (admin / system):
    ReceiptCreate   — internal creation (all fields explicit, admin-only)
    ReceiptUpdate   — internal partial update
    ReceiptRead     — full receipt DTO (admin / debug)
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from src.receipt.models import MAX_ATTACHMENTS_PER_RECEIPT, ReceiptFileKind, ReceiptStatus

# ---------------------------------------------------------------------------
# Shared sub-models
# ---------------------------------------------------------------------------


class ReceiptItem(BaseModel):
    """A single matched line item — stored in receipt.items JSONB."""

    raw_name: str
    qty: float
    price: int
    matched_sku_id: int | None = None
    confidence: float | None = None


class ReceiptFraudSignal(BaseModel):
    """Anti-fraud signal recorded against a receipt."""

    signal: str
    severity: str
    duplicate_of_id: int | None = None
    details: dict[str, Any] | None = None


class ReceiptAttachmentRead(BaseModel):
    """One file of the receipt package, ordered by ``position``.

    ``url`` is a browser-viewable URL (presigned/public) derived from the internal
    ``storage_uri`` — the raw storage key is never exposed. ``url`` is ``None`` for
    non-viewable backends (e.g. ``local://`` in pure-local dev).
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    position: int
    kind: Literal["image", "pdf"]
    mime_type: str
    url: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _derive_url_from_orm(cls, data: Any) -> Any:
        """When validating an ORM ``ReceiptAttachment``, derive the viewable ``url``
        from its internal ``storage_uri`` (never expose the raw storage key)."""
        if hasattr(data, "storage_uri"):
            from src.receipt_ocr.storage import to_viewable_url  # noqa: PLC0415 — avoid import cycle

            return {
                "id": data.id,
                "position": data.position,
                "kind": getattr(data.kind, "value", data.kind),
                "mime_type": data.mime_type,
                "url": to_viewable_url(data.storage_uri),
            }
        return data


# ---------------------------------------------------------------------------
# Public TMA / client-facing schemas (H24)
# ---------------------------------------------------------------------------


class ReceiptQrPayloadIn(BaseModel):
    """Request body for POST /api/v1/receipts/qr-payload.

    The TMA QR scanner passes the raw string directly without wrapping it in a file.
    """

    qr_raw: str = Field(
        ...,
        min_length=10,
        max_length=1000,
        description="Raw Russian fiscal QR string, e.g. t=...&s=...&fn=...&i=...&fp=...&n=1",
    )
    brand_id: int = Field(..., description="Brand the seller is registering this receipt against")


class ReceiptUploadResponse(BaseModel):
    """202 response returned by POST /api/v1/receipts/upload."""

    receipt_id: int
    status: str = "pending"
    message: str = "Receipt accepted for processing"


class ReceiptStatusResponse(BaseModel):
    """Lightweight polling response for GET /api/v1/receipts/{id}/status.

    Only fields needed by the TMA to render the status screen.
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    receipt_id: int = Field(..., alias="id")
    status: ReceiptStatus
    bonus_amount: int
    rejection_reason: str | None = None
    # Browser-viewable URL of the uploaded receipt photo/file (S4). None for
    # inline-QR submissions (no photo) or non-viewable storage URIs.
    # Legacy mirror of attachments[0].url — prefer `attachments`.
    file_url: str | None = None
    # Ordered package attachments (S4: seller sees every uploaded photo/file).
    attachments: list[ReceiptAttachmentRead] = Field(default_factory=list)


class ReceiptReviewAction(BaseModel):
    """Request body for admin approve / reject / revise endpoints (H22)."""

    comment: str | None = Field(default=None, description="Optional moderator comment / rejection reason")


# ---------------------------------------------------------------------------
# Presigned upload schemas
# ---------------------------------------------------------------------------


class PresignedUploadRequest(BaseModel):
    """Request body for POST /api/v1/receipts/upload-url."""

    mime: str = Field(..., description="MIME type of the file to upload, e.g. image/jpeg")


class PresignedUploadResponse(BaseModel):
    """Response from POST /api/v1/receipts/upload-url."""

    upload_url: str = Field(..., description="S3 presigned POST URL")
    fields: dict[str, str] = Field(..., description="Form fields to include in the multipart POST body")
    storage_uri: str = Field(..., description="s3:// URI that will be produced after upload completes")
    expires_in: int = Field(..., description="Lifetime of the presigned POST in seconds")


class FinalizeUploadRequest(BaseModel):
    """Request body for POST /api/v1/receipts/finalize."""

    storage_uri: str = Field(..., description="The storage URI returned by upload-url")
    mime: str = Field(..., description="MIME type of the uploaded file")
    brand_id: int = Field(..., description="Brand the seller is registering this receipt against")


# ---------------------------------------------------------------------------
# Package upload schemas (1..5 files = one Receipt)
# ---------------------------------------------------------------------------


class PackageFileMeta(BaseModel):
    """Per-file metadata supplied by the client when requesting presigned URLs."""

    client_id: str = Field(..., min_length=1, max_length=64, description="Client-side id used to correlate slots")
    filename: str = Field(..., min_length=1, max_length=512)
    mime: str = Field(..., description="MIME type, e.g. image/jpeg or application/pdf")
    size: int = Field(..., ge=0, description="File size in bytes (server re-validates)")


class PackageUploadUrlsRequest(BaseModel):
    """Body for POST /receipts/upload-urls — request 1..5 presigned upload slots."""

    files: list[PackageFileMeta] = Field(..., min_length=1, max_length=MAX_ATTACHMENTS_PER_RECEIPT)


class PackageUploadSlot(BaseModel):
    """One presigned upload slot returned by /receipts/upload-urls."""

    client_id: str
    position: int
    upload_url: str
    fields: dict[str, str]
    storage_uri: str


class PackageUploadUrlsResponse(BaseModel):
    """Response from POST /receipts/upload-urls."""

    upload_session: str = Field(..., description="Signed session token binding the issued storage keys to the seller")
    files: list[PackageUploadSlot]
    expires_in: int


class PackageAttachmentInput(BaseModel):
    """One finalized attachment referenced by the package finalize request."""

    position: int = Field(..., ge=0, lt=MAX_ATTACHMENTS_PER_RECEIPT)
    storage_uri: str = Field(..., max_length=1000)
    mime: str = Field(...)


class PackageFinalizeRequest(BaseModel):
    """Body for POST /receipts/finalize (package).

    One submission → one Receipt with 1..5 attachments + an optional scanned QR.
    ``idempotency_key`` makes a retried finalize return the existing receipt.
    """

    upload_session: str = Field(..., description="Token returned by /receipts/upload-urls")
    brand_id: int
    idempotency_key: str = Field(..., min_length=8, max_length=64)
    attachments: list[PackageAttachmentInput] = Field(..., min_length=1, max_length=MAX_ATTACHMENTS_PER_RECEIPT)
    scanned_qr: str | None = Field(default=None, max_length=1000, description="Optional raw QR scanned by the camera")

    @model_validator(mode="after")
    def _check_positions(self) -> PackageFinalizeRequest:
        positions = [a.position for a in self.attachments]
        if len(set(positions)) != len(positions):
            raise ValueError("attachment positions must be unique")
        if sorted(positions) != list(range(len(positions))):
            raise ValueError(f"attachment positions must be 0..{len(positions) - 1} with no gaps")
        return self


# ---------------------------------------------------------------------------
# Internal / admin schemas
# ---------------------------------------------------------------------------


class ReceiptCreate(BaseModel):
    """Internal schema for manual admin receipt creation.

    Note (H24): Client-facing upload goes through POST /receipts/upload
    (multipart) — not this schema. OCR fields default to empty so they can
    be filled in by the pipeline worker.
    """

    seller_id: int = Field(..., description="Seller telegram_id")
    brand_id: int
    file_kind: ReceiptFileKind
    file_url: str = Field(..., max_length=1000)
    file_hash: str = Field(..., max_length=128, description="SHA-256 hex digest of file content")

    # Status defaults to pending; override only for admin-created receipts.
    status: ReceiptStatus = ReceiptStatus.pending
    bonus_amount: int = 0
    rejection_reason: str | None = None

    # OCR / pipeline fields — default empty, filled by worker.
    purchase_date: date | None = None
    total_sum: int | None = Field(default=None, description="Total in kopecks")
    shop_name: str | None = Field(default=None, max_length=255)
    shop_inn: str | None = Field(default=None, max_length=32)
    qr_raw: str | None = Field(default=None, max_length=1000)
    fn: str | None = Field(default=None, max_length=64)
    fd: str | None = Field(default=None, max_length=64)
    fp: str | None = Field(default=None, max_length=64)
    ocr_confidence: float | None = None
    ocr_raw: dict[str, Any] | None = None
    items: list[ReceiptItem] = Field(default_factory=list)
    fraud_signals: list[ReceiptFraudSignal] = Field(default_factory=list)
    is_deleted: bool = False


class ReceiptUpdate(BaseModel):
    """Internal partial update schema (system / admin)."""

    status: ReceiptStatus | None = None
    bonus_amount: int | None = None
    rejection_reason: str | None = None
    file_kind: ReceiptFileKind | None = None
    file_url: str | None = Field(default=None, max_length=1000)
    file_hash: str | None = Field(default=None, max_length=128)
    purchase_date: date | None = None
    total_sum: int | None = None
    shop_name: str | None = Field(default=None, max_length=255)
    shop_inn: str | None = Field(default=None, max_length=32)
    qr_raw: str | None = Field(default=None, max_length=1000)
    fn: str | None = Field(default=None, max_length=64)
    fd: str | None = Field(default=None, max_length=64)
    fp: str | None = Field(default=None, max_length=64)
    ocr_confidence: float | None = None
    ocr_raw: dict[str, Any] | None = None
    items: list[ReceiptItem] | None = None
    fraud_signals: list[ReceiptFraudSignal] | None = None
    is_deleted: bool | None = None


class AdminComment(BaseModel):
    """Single admin internal comment entry stored in receipt.admin_comments."""

    author_telegram_id: int
    text: str
    created_at: datetime


class ReceiptCommentRequest(BaseModel):
    """Body for POST /receipts/{id}/comment (T4)."""

    text: str = Field(..., min_length=1, max_length=2000, description="Admin internal comment (1-2000 chars)")


class ReceiptEditBonusRequest(BaseModel):
    """Body for PATCH /receipts/{id}/bonus (T3)."""

    bonus_amount: int = Field(..., ge=0, description="New bonus amount in kopecks")


class ReceiptRead(BaseModel):
    """Full receipt DTO — admin / internal use."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    seller_id: int
    brand_id: int
    status: ReceiptStatus
    bonus_amount: int
    rejection_reason: str | None = None
    # Legacy single-file fields — nullable since the package model (mirror of
    # attachments[0]); prefer `attachments` below.
    file_kind: ReceiptFileKind | None = None
    file_url: str | None = None
    file_hash: str | None = None
    purchase_date: date | None = None
    total_sum: int | None = None
    shop_name: str | None = None
    shop_inn: str | None = None
    qr_raw: str | None = None
    fn: str | None = None
    fd: str | None = None
    fp: str | None = None
    ocr_confidence: float | None = None
    ocr_raw: dict[str, Any] | None = None
    items: list[ReceiptItem]
    fraud_signals: list[ReceiptFraudSignal]
    # Ordered package attachments (admin viewer source of truth). Legacy `file_url`
    # above is kept as a mirror of attachments[0].url during the transition.
    attachments: list[ReceiptAttachmentRead] = Field(default_factory=list)
    admin_comments: list[AdminComment] = Field(default_factory=list)
    # Joined from the seller (filled by the admin list/detail endpoints) so the
    # review card shows the real name + store instead of "Продавец #id".
    seller_name: str | None = None
    seller_store: str | None = None
    is_deleted: bool
    created_at: datetime
    updated_at: datetime | None = None
    created_by: int | None = None
    updated_by: int | None = None

    @field_validator("admin_comments", mode="before")
    @classmethod
    def _coerce_admin_comments(cls, v: Any) -> list:
        """Handle None from DB rows that predate the admin_comments column."""
        if v is None:
            return []
        return v
