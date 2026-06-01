from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.app.postgres.base import DEFAULT_SCHEMA, TimeStampedModel


class City(TimeStampedModel):
    """Reference dictionary of cities allowed during seller registration.

    Source of truth for the registration form: the frontend renders the city
    dropdown from ``GET /cities`` and the backend validates that a submitted
    ``seller.city`` belongs to the active dictionary.
    """

    __tablename__ = "city"
    __table_args__ = {"schema": DEFAULT_SCHEMA}

    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    region: Mapped[str | None] = mapped_column(String(255), default=None, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=1000, nullable=False)

    created_by: Mapped[int | None] = mapped_column(BigInteger, default=None, nullable=True)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, default=None, nullable=True)
