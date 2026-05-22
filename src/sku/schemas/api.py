from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class SkuCreate(BaseModel):
    brand_id: int
    code: str = Field(..., max_length=64, description="Unique SKU code")
    name: str = Field(..., max_length=255)
    category: Optional[str] = Field(default=None, max_length=128)
    default_bonus: int = 0
    aliases: list[str] = Field(default_factory=list, description="OCR-matching aliases")
    is_active: bool = True


class SkuUpdate(BaseModel):
    brand_id: Optional[int] = None
    code: Optional[str] = Field(default=None, max_length=64)
    name: Optional[str] = Field(default=None, max_length=255)
    category: Optional[str] = Field(default=None, max_length=128)
    default_bonus: Optional[int] = None
    aliases: Optional[list[str]] = None
    is_active: Optional[bool] = None


class SkuRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    brand_id: int
    code: str
    name: str
    category: Optional[str] = None
    default_bonus: int
    aliases: list[str]
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
