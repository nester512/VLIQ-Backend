from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from src.admin.models import AdminRole


class AdminCreate(BaseModel):
    telegram_id: int = Field(..., description="Telegram user ID (used as PK)")
    phone_e164: str = Field(..., max_length=32)
    first_name: Optional[str] = Field(default=None, max_length=255)
    last_name: Optional[str] = Field(default=None, max_length=255)
    role: AdminRole = AdminRole.admin
    brand_ids: list[int] = Field(default_factory=list, description="Brand IDs (empty = all brands)")
    is_active: bool = True


class AdminUpdate(BaseModel):
    phone_e164: Optional[str] = Field(default=None, max_length=32)
    first_name: Optional[str] = Field(default=None, max_length=255)
    last_name: Optional[str] = Field(default=None, max_length=255)
    role: Optional[AdminRole] = None
    brand_ids: Optional[list[int]] = None
    is_active: Optional[bool] = None


class AdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    telegram_id: int
    phone_e164: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: AdminRole
    brand_ids: list[int]
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
