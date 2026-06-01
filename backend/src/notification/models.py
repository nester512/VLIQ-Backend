from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import TIMESTAMP, BigInteger, ForeignKey, Integer, Text, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, IDModel


class NotificationType(str, Enum):
    receipt_approved = "receipt_approved"
    receipt_rejected = "receipt_rejected"
    bonus_accrued = "bonus_accrued"
    payout_sent = "payout_sent"
    promo_started = "promo_started"
    promo_ending = "promo_ending"


class NotificationDeliveryStatus(str, Enum):
    queued = "queued"
    sent = "sent"
    delivered = "delivered"
    failed = "failed"


class Notification(IDModel):
    __tablename__ = "notification"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    seller_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{DEFAULT_SCHEMA}.seller.telegram_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    type: Mapped[str] = mapped_column(
        SAEnum(
            NotificationType,
            name="notification_type_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)

    telegram_message_id: Mapped[int | None] = mapped_column(BigInteger, default=None)
    sent_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), default=None)
    read_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), default=None)

    delivery_status: Mapped[str] = mapped_column(
        SAEnum(
            NotificationDeliveryStatus,
            name="notification_delivery_status_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=NotificationDeliveryStatus.queued.value,
        nullable=False,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class NotificationOutbox(IDModel):
    """Transactional outbox for fault-tolerant notification delivery.

    Written in the SAME transaction as the business event; drained by a
    background worker that retries with exponential backoff.

    status: 'pending' | 'sent' | 'dead'
    channel: 'telegram' | 'in_app'
    """

    __tablename__ = "notification_outbox"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    scheduled_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending", server_default="pending")
    recipient_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    template: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    sent_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True, default=None)
