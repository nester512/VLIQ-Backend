from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    Enum as SAEnum,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, BaseModel


class SellerStatus(str, Enum):
    active = "active"
    pending = "pending"
    blocked = "blocked"


class PayoutKind(str, Enum):
    card = "card"
    sbp_phone = "sbp_phone"
    sbp_bank = "sbp_bank"


class Seller(BaseModel):
    __tablename__ = "seller"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    telegram_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)

    brand_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{DEFAULT_SCHEMA}.brand.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    phone_e164: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)

    first_name: Mapped[str | None] = mapped_column(String(255), default=None)
    last_name: Mapped[str | None] = mapped_column(String(255), default=None)
    city: Mapped[str | None] = mapped_column(String(255), default=None)
    region: Mapped[str | None] = mapped_column(String(255), default=None)
    outlet_name: Mapped[str | None] = mapped_column(String(255), default=None)
    outlet_address: Mapped[str | None] = mapped_column(String(255), default=None)
    outlet_chain: Mapped[str | None] = mapped_column(String(255), default=None)
    outlet_inn: Mapped[str | None] = mapped_column(String(32), default=None)
    position: Mapped[str | None] = mapped_column(String(255), default=None)

    status: Mapped[str] = mapped_column(
        SAEnum(
            SellerStatus,
            name="seller_status_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=SellerStatus.pending.value,
        nullable=False,
        index=True,
    )
    block_reason: Mapped[str | None] = mapped_column(Text, default=None)

    payout_kind: Mapped[str | None] = mapped_column(
        SAEnum(
            PayoutKind,
            name="payout_kind_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=None,
    )
    payout_masked: Mapped[str | None] = mapped_column(String(64), default=None)
    payout_encrypted: Mapped[str | None] = mapped_column(Text, default=None)

    consent_pdn_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), default=None)

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.current_timestamp(),
    )
    created_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
