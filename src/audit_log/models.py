from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import TIMESTAMP, BigInteger, Enum as SAEnum, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, IDModel


class ActorType(str, Enum):
    seller = "seller"
    admin = "admin"
    system = "system"


class AuditLog(IDModel):
    __tablename__ = "audit_log"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    # Polymorphic actor — no FK. The discriminator is actor_type.
    actor_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    actor_type: Mapped[str] = mapped_column(
        SAEnum(
            ActorType,
            name="audit_log_actor_type_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    action: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
        comment="e.g. approve_receipt | reject_receipt | edit_bonus | comment | block_seller | approve_payout",
    )

    entity_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="e.g. receipt | payout | seller | promotion",
    )
    entity_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)

    comment: Mapped[str | None] = mapped_column(Text, default=None)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
