"""Functional tests for GET /analytics/dashboard: admin-only, returns the service DTO.

The SQL aggregates are verified against real PostgreSQL in
tests/integration/pg/test_admin_dashboard_pg.py.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from src.admin.models import Admin, AdminRole
from src.analytics.handlers.api.v1 import router as analytics_router
from src.analytics.schemas.api import AdminDashboard, DashboardDay, DashboardTopProduct, DashboardTopSeller
from src.app.auth.jwt import jwt_auth
from src.seller.models import Seller

URL = "/api/v1/analytics/dashboard"


def _token(role: AdminRole | None) -> str:
    if role is None:
        seller = MagicMock(spec=Seller)
        seller.telegram_id = 12345
        return jwt_auth.create_token(seller)
    admin = MagicMock(spec=Admin)
    admin.telegram_id = 999
    admin.role = role
    admin.is_active = True
    return jwt_auth.create_token(admin)


@pytest.fixture
def stub_dashboard(monkeypatch: pytest.MonkeyPatch) -> AdminDashboard:
    dto = AdminDashboard(
        sellers_total=2000,
        sellers_active=1800,
        receipts_total=75000,
        receipts_on_review=321,
        payouts_pending=12,
        payouts_pending_amount=120000,
        payouts_paid_month=40,
        payouts_paid_month_amount=400000,
        avg_check=150000,
        daily_receipts=[DashboardDay(day=date(2026, 10, 8), receipts=9)],
        top_sellers=[
            DashboardTopSeller(
                telegram_id=1, name="Ivan", city=None, receipts_total=3, receipts_approved=2, sales=500, paid=100
            )
        ],
        top_products=[DashboardTopProduct(name="SWONQ", count=4)],
        generated_at=datetime(2026, 10, 8, tzinfo=UTC),
    )

    async def _fake(_session):
        return dto

    monkeypatch.setattr(analytics_router, "get_admin_dashboard", _fake)
    return dto


@pytest.mark.asyncio
async def test_dashboard__no_token__401(client: AsyncClient) -> None:
    assert (await client.get(URL)).status_code == 401


@pytest.mark.asyncio
async def test_dashboard__seller_token__403(client: AsyncClient, stub_dashboard) -> None:
    response = await client.get(URL, headers={"Authorization": f"Bearer {_token(None)}"})
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [AdminRole.admin, AdminRole.super_admin])
async def test_dashboard__admin__returns_aggregates(client: AsyncClient, stub_dashboard, role) -> None:
    response = await client.get(URL, headers={"Authorization": f"Bearer {_token(role)}"})

    assert response.status_code == 200
    body = response.json()
    assert body["sellers_total"] == 2000
    assert body["receipts_on_review"] == 321
    assert body["daily_receipts"] == [{"day": "2026-10-08", "receipts": 9}]
    assert body["top_sellers"][0]["sales"] == 500
    assert body["top_products"] == [{"name": "SWONQ", "count": 4.0}]
