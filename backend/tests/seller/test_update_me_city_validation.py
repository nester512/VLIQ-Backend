"""Tests for city-dictionary validation on PATCH /sellers/me.

The seller registration form sources its city dropdown from ``GET /cities`` and
the backend must reject any ``city`` that is not in the (active) dictionary with
a clean ``SELLER_CITY_INVALID`` 400 envelope. When ``city`` is omitted the
validation must be skipped entirely (no needless DB round-trip).
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.seller.models import Seller

PREFIX = "/api/v1/sellers"

_VALIDATOR = "src.seller.handlers.api.v1.router.city_name_is_valid"


def _seller_token(telegram_id: int = 700000444) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


def _pending_seller(telegram_id: int = 700000444) -> Seller:
    # Complete mock: the success-path tests reach SellerRead.model_validate(row),
    # which requires every field to be a real value (not a child MagicMock).
    s = MagicMock(spec=Seller)
    s.telegram_id = telegram_id
    s.brand_id = 1
    s.phone_e164 = f"+99{telegram_id}"  # synthetic stub from auto-create
    s.first_name = None
    s.last_name = None
    s.city = None
    s.region = None
    s.outlet_name = None
    s.outlet_address = None
    s.outlet_count = None
    s.outlet_chain = None
    s.outlet_inn = None
    s.position = None
    s.status = "pending"
    s.block_reason = None
    s.payout_kind = None
    s.payout_masked = None
    s.created_at = datetime(2024, 1, 1, 12, 0, 0)
    s.updated_at = None
    s.created_by = None
    s.updated_by = None
    return s


def _make_session(select_row: Seller) -> MagicMock:
    """Mock session: 1st execute = SELECT (row), 2nd execute = UPDATE (ok)."""
    session = MagicMock(spec=AsyncSession)

    select_result = MagicMock()
    select_result.scalar_one_or_none.return_value = select_row

    session.execute = AsyncMock(side_effect=[select_result, MagicMock()])
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    return session


def _override_session(app, session: MagicMock) -> None:
    async def _override():
        yield session

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override


@pytest.mark.asyncio
async def test_update_me__invalid_city__returns_400(client: AsyncClient, app) -> None:
    """City outside the dictionary → 400 SELLER_CITY_INVALID envelope."""
    # Arrange
    session = _make_session(_pending_seller())
    _override_session(app, session)
    payload = {"city": "Атлантида", "outlet_name": "Shop"}

    # Act
    with patch(_VALIDATOR, new=AsyncMock(return_value=False)):
        resp = await client.patch(
            f"{PREFIX}/me",
            json=payload,
            headers={"Authorization": f"Bearer {_seller_token()}"},
        )

    # Assert — full envelope; no UPDATE/commit happened (only the SELECT ran).
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == "SELLER_CITY_INVALID"
    assert body["user_message"] == "Выберите город из списка."
    assert body["debug_id"]
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_me__valid_city__updates_ok(client: AsyncClient, app) -> None:
    """City present in the dictionary → 200 and the update is committed."""
    # Arrange
    session = _make_session(_pending_seller())
    _override_session(app, session)
    payload = {"city": "Москва", "outlet_name": "Shop"}

    # Act
    validator = AsyncMock(return_value=True)
    with patch(_VALIDATOR, new=validator):
        resp = await client.patch(
            f"{PREFIX}/me",
            json=payload,
            headers={"Authorization": f"Bearer {_seller_token()}"},
        )

    # Assert
    assert resp.status_code == 200
    validator.assert_awaited_once()
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_me__city_omitted__skips_validation(client: AsyncClient, app) -> None:
    """No ``city`` in the payload → city_name_is_valid must NOT be called."""
    # Arrange
    session = _make_session(_pending_seller())
    _override_session(app, session)
    payload = {"outlet_name": "Shop"}

    # Act
    validator = AsyncMock(return_value=True)
    with patch(_VALIDATOR, new=validator):
        resp = await client.patch(
            f"{PREFIX}/me",
            json=payload,
            headers={"Authorization": f"Bearer {_seller_token()}"},
        )

    # Assert
    assert resp.status_code == 200
    validator.assert_not_awaited()
    assert validator.call_count == 0
