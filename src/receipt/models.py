from __future__ import annotations

from datetime import date
from enum import Enum

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, TimeStampedModel


class ReceiptStatus(str, Enum):
    pending = "pending"
    on_review = "on_review"
    approved = "approved"
    rejected = "rejected"
    needs_revision = "needs_revision"
    paid_out = "paid_out"


class ReceiptFileKind(str, Enum):
    photo = "photo"
    pdf = "pdf"
    qr = "qr"
    screenshot = "screenshot"


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

    file_kind: Mapped[str] = mapped_column(
        SAEnum(
            ReceiptFileKind,
            name="receipt_file_kind_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    file_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)

    purchase_date: Mapped[date | None] = mapped_column(Date, default=None)
    total_sum: Mapped[int | None] = mapped_column(Integer, default=None)
    shop_name: Mapped[str | None] = mapped_column(String(255), default=None)
    shop_inn: Mapped[str | None] = mapped_column(String(32), default=None)

    qr_raw: Mapped[str | None] = mapped_column(String(1000), default=None, unique=True)
    fn: Mapped[str | None] = mapped_column(String(64), default=None)
    fd: Mapped[str | None] = mapped_column(String(64), default=None)
    fp: Mapped[str | None] = mapped_column(String(64), default=None)

    ocr_confidence: Mapped[float | None] = mapped_column(Float, default=None)
    ocr_raw: Mapped[dict | None] = mapped_column(JSONB, default=None)

    # JSONB list per ERD: [{raw_name, qty, price, matched_sku_id, confidence}, ...]
    items: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    # JSONB list per ERD: [{signal, severity, duplicate_of_id, details}, ...]
    fraud_signals: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    created_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
