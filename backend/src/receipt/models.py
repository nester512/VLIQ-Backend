from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    Boolean,
    Date,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.app.postgres.base import DEFAULT_SCHEMA, IDModel, TimeStampedModel


class ReceiptStatus(StrEnum):
    pending = "pending"
    ocr_in_progress = "ocr_in_progress"
    on_review = "on_review"
    approved = "approved"
    rejected = "rejected"
    needs_revision = "needs_revision"
    paid_out = "paid_out"


class ReceiptSource(StrEnum):
    """How the seller produced the fiscal data (QR intake). NULL for legacy file uploads."""

    telegram_scan = "telegram_scan"
    camera_scan = "camera_scan"
    image_decode = "image_decode"
    pdf_decode = "pdf_decode"
    manual = "manual"


class VerificationStatus(StrEnum):
    """Automatic OFD check of a receipt — independent of the moderation status."""

    not_required = "not_required"  # legacy / no fiscal data
    pending = "pending"  # accepted, first attempt not run yet
    retrying = "retrying"  # an attempt failed, the cron will try again
    verified = "verified"  # OFD returned the receipt
    failed = "failed"  # retries exhausted — manual check only


class VerificationOutcome(StrEnum):
    ok = "ok"
    not_found = "not_found"
    invalid = "invalid"
    rate_limited = "rate_limited"
    error = "error"
    blocked = "blocked"


class ReceiptFileKind(StrEnum):
    photo = "photo"
    pdf = "pdf"
    qr = "qr"
    screenshot = "screenshot"


class AttachmentKind(StrEnum):
    """Coarse attachment type used by the frontend viewer (image vs pdf)."""

    image = "image"
    pdf = "pdf"


# Server-validated MIME types accepted for receipt attachments.
ALLOWED_ATTACHMENT_MIME_TYPES: frozenset[str] = frozenset(
    {"image/jpeg", "image/png", "image/webp", "application/pdf"}
)

# Max number of attachments in one receipt submission (package), per spec (1..5).
MAX_ATTACHMENTS_PER_RECEIPT = 5

# Max accepted size per attachment (10 MiB) — server-enforced.
MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024


def attachment_kind_for_mime(mime: str) -> AttachmentKind:
    """Map a server-validated MIME type to the coarse :class:`AttachmentKind`.

    ``application/pdf`` → ``pdf``; all accepted image types → ``image``.
    """
    return AttachmentKind.pdf if mime.split(";")[0].strip().lower() == "application/pdf" else AttachmentKind.image


class Receipt(TimeStampedModel):
    __tablename__ = "receipt"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    seller_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{DEFAULT_SCHEMA}.seller.telegram_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    brand_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{DEFAULT_SCHEMA}.brand.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        SAEnum(
            ReceiptStatus,
            name="receipt_status_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=ReceiptStatus.pending.value,
        nullable=False,
        index=True,
    )
    bonus_amount: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rejection_reason: Mapped[str | None] = mapped_column(Text, default=None)
    # Machine-readable rejection cause (e.g. MULTIPLE_RECEIPTS_DETECTED). NULL for
    # ordinary admin rejections — lets the admin UI tell system vs manual rejection.
    rejection_code: Mapped[str | None] = mapped_column(String(64), default=None)

    # Legacy single-file columns. Since 0005 they are a nullable *mirror* of
    # attachments[0] (kept for backward-compatible reads); the authoritative
    # source of files is the receipt_attachment child table. New package
    # receipts populate them from the primary attachment. QR-only legacy rows
    # keep file_kind='qr' / file_url='qr://inline'.
    file_kind: Mapped[str | None] = mapped_column(
        SAEnum(
            ReceiptFileKind,
            name="receipt_file_kind_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=True,
    )
    file_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # Non-unique index since 0005 — duplicate hashes are a fraud *signal*, not a
    # hard block (the old partial UNIQUE uq_receipt_file_hash_active was dropped).
    file_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)

    # Idempotency key for the package finalize (one client submission). A retried
    # finalize with the same (seller_id, key) returns the existing receipt instead
    # of creating a second one. Partial-unique index defined in migration 0005.
    upload_idempotency_key: Mapped[str | None] = mapped_column(String(64), default=None)

    purchase_date: Mapped[date | None] = mapped_column(Date, default=None)
    total_sum: Mapped[int | None] = mapped_column(Integer, default=None)
    shop_name: Mapped[str | None] = mapped_column(String(255), default=None)
    shop_inn: Mapped[str | None] = mapped_column(String(32), default=None)

    # B8: global unique=False — partial UNIQUE (WHERE qr_raw IS NOT NULL AND is_deleted = false) in migration.
    qr_raw: Mapped[str | None] = mapped_column(String(1000), default=None)
    fn: Mapped[str | None] = mapped_column(String(64), default=None)
    fd: Mapped[str | None] = mapped_column(String(64), default=None)
    fp: Mapped[str | None] = mapped_column(String(64), default=None)

    ocr_confidence: Mapped[float | None] = mapped_column(Float, default=None)
    ocr_raw: Mapped[dict | None] = mapped_column(JSONB, default=None)

    # JSONB list per ERD: [{raw_name, qty, price, matched_sku_id, confidence}, ...]
    items: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    # JSONB list per ERD: [{signal, severity, duplicate_of_id, details}, ...]
    fraud_signals: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    # T4: admin internal comments — JSONB array of {author_telegram_id, text, created_at}
    admin_comments: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    # QR intake (docs/design/QR-INTAKE.md): source of the fiscal data + automatic OFD check.
    source: Mapped[str | None] = mapped_column(String(32), default=None)
    verification_status: Mapped[str] = mapped_column(
        String(16), default=VerificationStatus.not_required.value, server_default="not_required", nullable=False
    )
    verification_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    next_verification_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), default=None)
    verified_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), default=None)
    # The final («готовый») OFD answer of the successful attempt.
    ofd_response: Mapped[dict | None] = mapped_column(JSONB, default=None)

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    created_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, default=None)

    # Receipt aggregate: 1..5 ordered files (images / PDFs). Eager-loaded so DTO
    # builders and the pipeline see the package without an explicit await on the
    # lazy attribute (which is illegal under async SQLAlchemy).
    attachments: Mapped[list[ReceiptAttachment]] = relationship(
        "ReceiptAttachment",
        back_populates="receipt",
        order_by="ReceiptAttachment.position",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ReceiptAttachment(IDModel):
    """One uploaded file belonging to a :class:`Receipt` (the package aggregate).

    A single seller submission produces exactly one Receipt with 1..5 attachments;
    ``position`` gives a stable display order preserved from seller upload to the
    admin viewer. ``file_hash`` is indexed but **not** unique — a repeated file is
    a duplicate *signal* for the admin, never a hard block.
    """

    __tablename__ = "receipt_attachment"
    __table_args__ = (
        UniqueConstraint("receipt_id", "position", name="uq_receipt_attachment_receipt_position"),
        {"schema": DEFAULT_SCHEMA},
    )

    receipt_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{DEFAULT_SCHEMA}.receipt.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(
        SAEnum(
            AttachmentKind,
            name="attachment_kind_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    mime_type: Mapped[str] = mapped_column(String(127), nullable=False)
    storage_uri: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Per-attachment extraction evidence/provenance (QR candidates, PDF page
    # count, parse warnings) — diagnostic for the admin, kept across processing.
    extraction: Mapped[dict | None] = mapped_column(JSONB, default=None)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    receipt: Mapped[Receipt] = relationship("Receipt", back_populates="attachments")


class ReceiptVerificationAttempt(IDModel):
    """One OFD verification attempt (append-only history, visible to admins per receipt)."""

    __tablename__ = "receipt_verification_attempt"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    receipt_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{DEFAULT_SCHEMA}.receipt.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    method: Mapped[str] = mapped_column(String(32), nullable=False)
    trigger: Mapped[str] = mapped_column(String(16), nullable=False)  # pipeline | cron | admin
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    http_status: Mapped[int | None] = mapped_column(Integer, default=None)
    request: Mapped[dict | None] = mapped_column(JSONB, default=None)  # never contains the API token
    response: Mapped[dict | None] = mapped_column(JSONB, default=None)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    duration_ms: Mapped[int | None] = mapped_column(Integer, default=None)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
