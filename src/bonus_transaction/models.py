from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, IDModel


class BonusTransactionKind(str, Enum):
    accrual_receipt = "accrual_receipt"
    accrual_promo = "accrual_promo"
    accrual_manual = "accrual_manual"
    payout_hold = "payout_hold"
    payout_completed = "payout_completed"
    payout_reverted = "payout_reverted"
    correction = "correction"


class BonusTransaction(IDModel):
    __tablename__ = "bonus_transaction"
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

    amount: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="Signed amount in bonus units (positive=accrual, negative=spend)"
    )

    kind: Mapped[str] = mapped_column(
        SAEnum(
            BonusTransactionKind,
            name="bonus_transaction_kind_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    source_type: Mapped[str] = mapped_column(String(32), nullable=False, comment="receipt | payout | admin")
    source_id: Mapped[int | None] = mapped_column(BigInteger, default=None, comment="Polymorphic — no FK")

    promotion_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(f"{DEFAULT_SCHEMA}.promotion.id", ondelete="SET NULL"),
        default=None,
        index=True,
    )

    reason: Mapped[str | None] = mapped_column(Text, default=None)

    created_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
