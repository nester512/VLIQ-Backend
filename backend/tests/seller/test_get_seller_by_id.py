"""Tests for GET /sellers/{telegram_id} — admin-only single-seller fetch."""

from __future__ import annotations

from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.seller.handlers.api.v1 import router as seller_router
from src.seller.models import Seller, SellerStatus
from src.seller.schemas.api import SellerStats, SellerWeekActivity

PREFIX = "/api/v1/sellers"


def _make_seller(telegram_id: int = 12345) -> Seller:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    seller.brand_id = 1
    seller.phone_e164 = "+79991234567"
    seller.first_name = "Ivan"
    seller.last_name = "Petrov"
    seller.city = "Moscow"
    seller.region = None
    seller.outlet_name = "VLIQ Москва"
    seller.outlet_address = None
    seller.outlet_count = None
    seller.outlet_chain = None
    seller.outlet_inn = None
    seller.position = None
    seller.status = SellerStatus.active
    seller.block_reason = None
    seller.payout_kind = None
    seller.payout_masked = None
    seller.created_at = datetime(2024, 1, 1, 12, 0, 0)
    seller.updated_at = None
    seller.created_by = None
    seller.updated_by = None
    return seller


def _admin_token() -> str:
    from src.admin.models import Admin, AdminRole

    admin = MagicMock(spec=Admin)
    admin.telegram_id = 999
    admin.role = AdminRole.admin
    admin.is_active = True
    return jwt_auth.create_token(admin)


def _seller_token(telegram_id: int = 12345) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


def _make_session_mock_for_seller(
    mock_seller: Seller | None,
    balance_available: int = 150,
    receipts_total: int = 7,
) -> MagicMock:
    """Build a session mock for the seller lookup + balance aggregate.

    Receipt statistics/risk/weekly activity are stubbed by ``_stub_stats`` — their
    SQL is covered against real PostgreSQL in tests/integration/pg.
    """
    # Result 1: seller lookup
    seller_result = MagicMock()
    seller_result.scalar_one_or_none.return_value = mock_seller

    # Result 2: balance aggregate (get_seller_balance calls session.execute once and reads .one())
    balance_row = MagicMock()
    balance_row.available_accruals = balance_available
    balance_row.payout_hold = 0
    balance_row.total_accrued = balance_available
    balance_row.payout_completed = 0
    balance_result = MagicMock()
    balance_result.one.return_value = balance_row

    session_mock = MagicMock(spec=AsyncSession)
    session_mock.execute = AsyncMock(side_effect=[seller_result, balance_result])
    _STATS["receipts_total"] = receipts_total
    return session_mock


_STATS: dict[str, int] = {"receipts_total": 0}


@pytest.fixture(autouse=True)
def _stub_stats(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stats(_session, _seller_id):
        n = _STATS["receipts_total"]
        return SellerStats(receipts_total=n, receipts_approved=n, risk_flags=["low_data"])

    async def _avg_bonus(_session, _seller_id):
        return 4200

    async def _weekly(_session, _seller_id):
        return [SellerWeekActivity(week_start=date(2024, 1, 1), receipts=3, approved=2)]

    monkeypatch.setattr(seller_router, "get_seller_stats", _stats)
    monkeypatch.setattr(seller_router, "get_seller_avg_bonus", _avg_bonus)
    monkeypatch.setattr(seller_router, "get_seller_weekly_activity", _weekly)


@pytest.mark.asyncio
async def test_get_seller__admin_token__200(client: AsyncClient, app):
    """Admin can fetch a seller by telegram_id → 200 with correct fields."""
    mock_seller = _make_seller(telegram_id=12345)
    session_mock = _make_session_mock_for_seller(mock_seller)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    response = await client.get(
        f"{PREFIX}/12345",
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["telegram_id"] == 12345
    assert body["first_name"] == "Ivan"
    assert body["status"] == "active"


@pytest.mark.asyncio
async def test_get_seller__admin_token__has_balance_and_receipt_count(client: AsyncClient, app):
    """GET /sellers/{id} response includes balance_available and receipts_total."""
    mock_seller = _make_seller(telegram_id=12345)
    session_mock = _make_session_mock_for_seller(
        mock_seller,
        balance_available=250,
        receipts_total=12,
    )

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    response = await client.get(
        f"{PREFIX}/12345",
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert "balance_available" in body, "balance_available must be present in response"
    assert "receipts_total" in body, "receipts_total must be present in response"
    assert body["balance_available"] == 250
    assert body["receipts_total"] == 12
    # Admin card extras: stats/risk, balance breakdown, avg bonus, weekly activity.
    assert body["stats"]["receipts_total"] == 12
    assert body["stats"]["risk_level"] == "low"
    assert body["total_accrued"] == 250
    assert body["on_hold"] == 0
    assert body["avg_bonus"] == 4200
    assert body["weekly_activity"] == [{"week_start": "2024-01-01", "receipts": 3, "approved": 2}]


@pytest.mark.asyncio
async def test_get_seller__zero_balance_and_zero_receipts(client: AsyncClient, app):
    """New seller with no transactions returns balance_available=0, receipts_total=0."""
    mock_seller = _make_seller(telegram_id=42)
    session_mock = _make_session_mock_for_seller(
        mock_seller,
        balance_available=0,
        receipts_total=0,
    )

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    response = await client.get(
        f"{PREFIX}/42",
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["balance_available"] == 0
    assert body["receipts_total"] == 0


@pytest.mark.asyncio
async def test_get_seller__not_found__404(client: AsyncClient, app):
    """Admin token + unknown telegram_id → 404 envelope with SELLER_NOT_FOUND."""
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None

    session_mock = MagicMock(spec=AsyncSession)
    session_mock.execute = AsyncMock(return_value=mock_result)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    response = await client.get(
        f"{PREFIX}/99999",
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "SELLER_NOT_FOUND"
    assert "user_message" in body
    assert "debug_id" in body


@pytest.mark.asyncio
async def test_get_seller__no_token__401(client: AsyncClient):
    """No Authorization header → 401."""
    response = await client.get(f"{PREFIX}/12345")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_seller__seller_token__403(client: AsyncClient):
    """Seller token → 403 (admin-only endpoint)."""
    response = await client.get(
        f"{PREFIX}/12345",
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )
    assert response.status_code == 403
