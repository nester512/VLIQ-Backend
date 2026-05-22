from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import TIMESTAMP, BigInteger, Boolean, Enum as SAEnum, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, BaseModel


class AdminRole(str, Enum):
    admin = "admin"
    super_admin = "super_admin"


class Admin(BaseModel):
    __tablename__ = "admin"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    telegram_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)

    phone_e164: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    first_name: Mapped[str | None] = mapped_column(String(255), default=None)
    last_name: Mapped[str | None] = mapped_column(String(255), default=None)

    role: Mapped[str] = mapped_column(
        SAEnum(
            AdminRole,
            name="admin_role_enum",
            schema=DEFAULT_SCHEMA,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=AdminRole.admin.value,
        nullable=False,
        index=True,
    )

    # JSONB array of brand IDs; empty list = access to all brands.
    brand_ids: Mapped[list[int]] = mapped_column(JSONB, default=list, nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.current_timestamp(),
    )
    created_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, default=None)
