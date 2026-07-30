"""Tests for POST /sellers/{telegram_id}/block and /unblock (T2)."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.seller.models import Seller

PREFIX = "/api/v1/sellers"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_seller(telegram_id: int = 55555, status: str = "active") -> Seller:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    seller.brand_id = 1
    seller.phone_e164 = "+79991110000"
    seller.first_name = "Test"
    seller.last_name = "Seller"
    seller.city = None
    seller.region = None
    seller.outlet_name = None
    seller.outlet_address = None
    seller.outlet_count = None
    seller.outlet_chain = None
    seller.outlet_inn = None
    seller.position = None
    seller.status = status
    seller.block_reason = None
    seller.payout_kind = None
    seller.payout_masked = None
    seller.created_at = datetime(2025, 1, 1, 12, 0, 0)
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


def _seller_token(telegram_id: int = 55555) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


def _make_block_session(seller: Seller | None) -> MagicMock:
    """Session mock for block/unblock: begin context + scalar_one_or_none + execute + add + refresh."""
    session_mock = MagicMock(spec=AsyncSession)

    # Lock query result
    lock_result = MagicMock()
    lock_result.scalar_one_or_none.return_value = seller

    session_mock.execute = AsyncMock(return_value=lock_result)
    session_mock.flush = AsyncMock()
    session_mock.refresh = AsyncMock()
    session_mock.add = MagicMock()
    session_mock.commit = AsyncMock()
    session_mock.rollback = AsyncMock()

    # async with session.begin() support
    begin_ctx = MagicMock()
    begin_ctx.__aenter__ = AsyncMock(return_value=begin_ctx)
    begin_ctx.__aexit__ = AsyncMock(return_value=False)
    session_mock.begin = MagicMock(return_value=begin_ctx)

    return session_mock


# ---------------------------------------------------------------------------
# Block tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_block_success(client: AsyncClient, app) -> None:
    """Admin can block an active seller → 200."""
    # seller.status = "active" so the handler doesn't 409
    mock_seller = _make_seller(status="active")
    session_mock = _make_block_session(mock_seller)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.post(
        f"{PREFIX}/55555/block",
        json={"reason": "Violation of terms"},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_already_blocked_409(client: AsyncClient, app) -> None:
    """Blocking an already-blocked seller returns 409."""
    mock_seller = _make_seller(status="blocked")
    session_mock = _make_block_session(mock_seller)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.post(
        f"{PREFIX}/55555/block",
        json={},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 409
    assert resp.json()["code"] == "SELLER_ALREADY_BLOCKED"


@pytest.mark.asyncio
async def test_seller_not_found_404(client: AsyncClient, app) -> None:
    """Block endpoint returns 404 if seller does not exist."""
    session_mock = _make_block_session(None)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.post(
        f"{PREFIX}/99999/block",
        json={},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 404
    assert resp.json()["code"] == "SELLER_NOT_FOUND"


@pytest.mark.asyncio
async def test_block_unauthorized_401(client: AsyncClient) -> None:
    """No token → 401."""
    resp = await client.post(f"{PREFIX}/55555/block", json={})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_block_forbidden_seller_role_403(client: AsyncClient) -> None:
    """Seller token → 403 (admin-only endpoint)."""
    resp = await client.post(
        f"{PREFIX}/55555/block",
        json={},
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Unblock tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unblock_success(client: AsyncClient, app) -> None:
    """Admin can unblock a blocked seller → 200."""
    # seller.status = "blocked" so the handler doesn't 409
    mock_seller = _make_seller(status="blocked")
    mock_seller.block_reason = "old reason"
    session_mock = _make_block_session(mock_seller)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.post(
        f"{PREFIX}/55555/unblock",
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_unblock_not_blocked_409(client: AsyncClient, app) -> None:
    """Unblocking a seller who is not blocked returns 409."""
    mock_seller = _make_seller(status="active")
    session_mock = _make_block_session(mock_seller)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.post(
        f"{PREFIX}/55555/unblock",
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 409
    assert resp.json()["code"] == "SELLER_NOT_BLOCKED"
