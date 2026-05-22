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
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, TimeStampedModel


class PromotionStatus(str, Enum):
    draft = "draft"
    active = "active"
    paused = "paused"
    finished = "finished"


class Promotion(TimeStampedModel):
    __tablename__ = "promotion"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    brand_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{DEFAULT_SCHEMA}.brand.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tag: Mapped[str | None] = mapped_column(String(64), default=None, index=True)
    description: Mapped[str | None] = mapped_column(Text, default=None)

    starts_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    status: Mapped[str] = mapped_column(
        SAEnum(
            PromotionStatus,
            name="promotion_status_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=PromotionStatus.draft.value,
        nullable=False,
        index=True,
    )
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # JSONB structures per ERD: each is a list of objects/strings; empty list = no scope filter (matches all).
    rules: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    scope_cities: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    scope_outlets: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    scope_skus: Mapped[list[int]] = mapped_column(JSONB, default=list, nullable=False)

    per_user_per_day: Mapped[int | None] = mapped_column(Integer, default=None)
    per_user_total: Mapped[int | None] = mapped_column(Integer, default=None)
    total_budget: Mapped[int | None] = mapped_column(Integer, default=None)

    created_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
