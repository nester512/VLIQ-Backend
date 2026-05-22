from __future__ import annotations

from enum import Enum

from sqlalchemy import BigInteger, Enum as SAEnum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, TimeStampedModel
from src.seller.models import PayoutKind


class PayoutRequestStatus(str, Enum):
    new = "new"
    in_progress = "in_progress"
    paid = "paid"
    rejected = "rejected"


class PayoutRequest(TimeStampedModel):
    __tablename__ = "payout_request"
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

    amount: Mapped[int] = mapped_column(Integer, nullable=False)

    payout_kind: Mapped[str] = mapped_column(
        SAEnum(
            PayoutKind,
            name="payout_kind_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
            create_type=False,  # Type is owned by `seller` table.
        ),
        nullable=False,
    )
    payout_masked: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="Snapshot of payout destination at the time of request",
    )

    status: Mapped[str] = mapped_column(
        SAEnum(
            PayoutRequestStatus,
            name="payout_request_status_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=PayoutRequestStatus.new.value,
        nullable=False,
        index=True,
    )

    admin_comment: Mapped[str | None] = mapped_column(Text, default=None)
    external_txn_id: Mapped[str | None] = mapped_column(String(128), default=None, index=True)

    created_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
