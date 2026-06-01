from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SkuCreate(BaseModel):
    brand_id: int
    code: str = Field(..., max_length=64, description="Unique SKU code")
    name: str = Field(..., max_length=255)
    category: str | None = Field(default=None, max_length=128)
    default_bonus: int = 0
    aliases: list[str] = Field(default_factory=list, description="OCR-matching aliases")
    is_active: bool = True


class SkuUpdate(BaseModel):
    brand_id: int | None = None
    code: str | None = Field(default=None, max_length=64)
    name: str | None = Field(default=None, max_length=255)
    category: str | None = Field(default=None, max_length=128)
    default_bonus: int | None = None
    aliases: list[str] | None = None
    is_active: bool | None = None


class SkuRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    brand_id: int
    code: str
    name: str
    category: str | None = None
    default_bonus: int
    aliases: list[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None
    created_by: int | None = None
    updated_by: int | None = None
