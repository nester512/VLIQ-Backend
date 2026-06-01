from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class BrandCreate(BaseModel):
    name: str = Field(..., max_length=255)
    slug: str = Field(
        ...,
        max_length=255,
        pattern=r"^[a-z0-9-]+$",
        description="Unique URL-safe brand identifier (lowercase letters, digits, hyphens only)",
    )
    settings: dict[str, Any] | None = None
    is_active: bool = True


class BrandUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    slug: str | None = Field(default=None, max_length=255, pattern=r"^[a-z0-9-]+$")
    settings: dict[str, Any] | None = None
    is_active: bool | None = None


class BrandRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    settings: dict[str, Any] | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None
    created_by: int | None = None
    updated_by: int | None = None
