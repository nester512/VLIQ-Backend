from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class BrandCreate(BaseModel):
    name: str = Field(..., max_length=255)
    slug: str = Field(..., max_length=255, description="Unique URL-safe brand identifier")
    settings: Optional[dict[str, Any]] = None
    is_active: bool = True


class BrandUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    slug: Optional[str] = Field(default=None, max_length=255)
    settings: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None


class BrandRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    settings: Optional[dict[str, Any]] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
