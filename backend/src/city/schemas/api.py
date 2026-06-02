from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    region: str | None = None
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime | None = None
