"""Common pagination query params and response envelope.

Usage:
    from src.app.api.pagination import PageParams, PagedResponse

    @router.get("", response_model=PagedResponse[SellerRead])
    async def list_sellers(params: Annotated[PageParams, Depends()]) -> PagedResponse[SellerRead]:
        ...
"""

from __future__ import annotations

from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")


class PageParams(BaseModel):
    """Shared pagination and sorting parameters for list endpoints."""

    page: int = Query(default=1, ge=1, description="Page number (1-based)")
    limit: int = Query(default=50, ge=1, le=200, description="Items per page")
    sort: str = Query(default="created_at:desc", description="Sort field and direction, e.g. created_at:desc")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.limit


class PagedResponse(BaseModel, Generic[T]):  # noqa: UP046
    """Generic paginated response envelope."""

    items: list[T]
    total: int
    page: int
    limit: int
    has_more: bool

    @classmethod
    def build(cls, *, items: list[T], total: int, page: int, limit: int) -> PagedResponse[T]:
        return cls(
            items=items,
            total=total,
            page=page,
            limit=limit,
            has_more=(page * limit) < total,
        )
