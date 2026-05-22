from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, TimeStampedModel


class Sku(TimeStampedModel):
    __tablename__ = "sku"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    brand_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{DEFAULT_SCHEMA}.brand.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str | None] = mapped_column(String(128), default=None)
    default_bonus: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # JSONB list of strings for OCR matching.
    aliases: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    created_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
