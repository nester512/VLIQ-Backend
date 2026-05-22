from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from src.promotion.models import PromotionStatus


class PromotionCreate(BaseModel):
    brand_id: int
    name: str = Field(..., max_length=255)
    tag: Optional[str] = Field(default=None, max_length=64)
    description: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    status: PromotionStatus = PromotionStatus.draft
    priority: int = 0
    rules: list[dict[str, Any]] = Field(default_factory=list, description="List of accrual rule objects")
    scope_cities: list[str] = Field(default_factory=list, description="Empty = all cities")
    scope_outlets: list[dict[str, Any]] = Field(default_factory=list, description="List of chain/INN scopes; empty = all")
    scope_skus: list[int] = Field(default_factory=list, description="List of SKU IDs; empty = all SKUs")
    per_user_per_day: Optional[int] = None
    per_user_total: Optional[int] = None
    total_budget: Optional[int] = None


class PromotionUpdate(BaseModel):
    brand_id: Optional[int] = None
    name: Optional[str] = Field(default=None, max_length=255)
    tag: Optional[str] = Field(default=None, max_length=64)
    description: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    status: Optional[PromotionStatus] = None
    priority: Optional[int] = None
    rules: Optional[list[dict[str, Any]]] = None
    scope_cities: Optional[list[str]] = None
    scope_outlets: Optional[list[dict[str, Any]]] = None
    scope_skus: Optional[list[int]] = None
    per_user_per_day: Optional[int] = None
    per_user_total: Optional[int] = None
    total_budget: Optional[int] = None


class PromotionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    brand_id: int
    name: str
    tag: Optional[str] = None
    description: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    status: PromotionStatus
    priority: int
    rules: list[dict[str, Any]]
    scope_cities: list[str]
    scope_outlets: list[dict[str, Any]]
    scope_skus: list[int]
    per_user_per_day: Optional[int] = None
    per_user_total: Optional[int] = None
    total_budget: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
