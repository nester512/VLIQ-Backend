from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, Boolean, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, TimeStampedModel


class Brand(TimeStampedModel):
    __tablename__ = "brand"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    created_by: Mapped[int | None] = mapped_column(BigInteger, default=None, nullable=True)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, default=None, nullable=True)
