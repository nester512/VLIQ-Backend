from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from src.admin.models import AdminRole


class AdminCreate(BaseModel):
    telegram_id: int = Field(..., description="Telegram user ID (used as PK)")
    phone_e164: str = Field(..., max_length=32, pattern=r"^\+[1-9]\d{7,14}$")
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)
    role: AdminRole = AdminRole.admin
    brand_ids: list[int] = Field(default_factory=list, description="Brand IDs (empty = all brands)")
    is_active: bool = True


class AdminUpdate(BaseModel):
    phone_e164: str | None = Field(default=None, max_length=32, pattern=r"^\+[1-9]\d{7,14}$")
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)
    role: AdminRole | None = None
    brand_ids: list[int] | None = None
    is_active: bool | None = None


class AdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    telegram_id: int
    phone_e164: str
    first_name: str | None = None
    last_name: str | None = None
    role: AdminRole
    brand_ids: list[int]
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None
    created_by: int | None = None
    updated_by: int | None = None
