"""Admin dashboard (A4 / UC-01) — every number is aggregated in SQL over the whole database."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class DashboardDay(BaseModel):
    day: date
    receipts: int


class DashboardTopSeller(BaseModel):
    telegram_id: int
    name: str
    city: str | None = None
    receipts_total: int
    receipts_approved: int
    sales: int = Field(description="Σ total_sum of approved receipts, kopecks")
    paid: int = Field(description="Σ paid payout requests, kopecks")


class DashboardTopProduct(BaseModel):
    name: str
    count: float


class AdminDashboard(BaseModel):
    sellers_total: int
    sellers_active: int
    receipts_total: int
    receipts_on_review: int
    payouts_pending: int = Field(description="Requests in new / in_progress")
    payouts_pending_amount: int
    payouts_paid_month: int = Field(description="Requests paid since the start of the current month")
    payouts_paid_month_amount: int
    avg_check: int = Field(description="Mean total_sum of approved receipts, kopecks")
    daily_receipts: list[DashboardDay] = Field(description="Uploads per day, last 30 days, zero-filled")
    top_sellers: list[DashboardTopSeller]
    top_products: list[DashboardTopProduct]
    generated_at: datetime
