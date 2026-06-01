from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from src.promotion.models import PromotionStatus


class PromotionCreate(BaseModel):
    brand_id: int
    name: str = Field(..., max_length=255)
    tag: str | None = Field(default=None, max_length=64)
    description: str | None = None
    starts_at: datetime
    ends_at: datetime
    status: PromotionStatus = PromotionStatus.draft
    priority: int = 0
    rules: list[dict[str, Any]] = Field(default_factory=list, description="List of accrual rule objects")
    scope_cities: list[str] = Field(default_factory=list, description="Empty = all cities")
    scope_outlets: list[dict[str, Any]] = Field(
        default_factory=list, description="List of chain/INN scopes; empty = all"
    )
    scope_skus: list[int] = Field(default_factory=list, description="List of SKU IDs; empty = all SKUs")
    per_user_per_day: int | None = None
    per_user_total: int | None = None
    total_budget: int | None = None


class PromotionUpdate(BaseModel):
    brand_id: int | None = None
    name: str | None = Field(default=None, max_length=255)
    tag: str | None = Field(default=None, max_length=64)
    description: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    status: PromotionStatus | None = None
    priority: int | None = None
    rules: list[dict[str, Any]] | None = None
    scope_cities: list[str] | None = None
    scope_outlets: list[dict[str, Any]] | None = None
    scope_skus: list[int] | None = None
    per_user_per_day: int | None = None
    per_user_total: int | None = None
    total_budget: int | None = None


class PromotionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    brand_id: int
    name: str
    tag: str | None = None
    description: str | None = None
    starts_at: datetime
    ends_at: datetime
    status: PromotionStatus
    priority: int
    rules: list[dict[str, Any]]
    scope_cities: list[str]
    scope_outlets: list[dict[str, Any]]
    scope_skus: list[int]
    per_user_per_day: int | None = None
    per_user_total: int | None = None
    total_budget: int | None = None
    created_at: datetime
    updated_at: datetime | None = None
    created_by: int | None = None
    updated_by: int | None = None
