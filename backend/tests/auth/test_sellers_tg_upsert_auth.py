"""Tests for POST /api/v1/sellers/tg-upsert auth enforcement (B2).

Authorization contract:
- No token → 401
- Token user_id != body.id → 403
- Token user_id == body.id → auth passes (repo called or 500 if mock insufficient)
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from jose import jwt
from src.app.auth.jwt import jwt_auth

PREFIX = "/api/v1/sellers"


def _make_seller_token(user_id: int) -> str:
    """Issue a real JWT for the given seller telegram_id."""
    now = datetime.now(UTC)
    payload = {
        "uid": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=6)).timestamp()),
        "user_id": user_id,
        "role": "seller",
    }
    return jwt.encode(payload, jwt_auth.secret, algorithm=jwt_auth.algorithm)


def _tg_upsert_body(user_id: int = 123456) -> dict:
    return {
        "id": user_id,
        "brand_id": 1,
        "phone_e164": "+79991234567",
        "first_name": "Test",
        "last_name": "User",
    }


@pytest.mark.asyncio
async def test_sellers_tg_upsert__no_token__returns_401(client: AsyncClient):
    """No Authorization header → 401."""
    response = await client.post(f"{PREFIX}/tg-upsert", json=_tg_upsert_body())
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_sellers_tg_upsert__wrong_user_id__returns_403(client: AsyncClient):
    """Token for user 111 but body.id = 222 → 403 Forbidden."""
    token = _make_seller_token(user_id=111)
    response = await client.post(
        f"{PREFIX}/tg-upsert",
        json=_tg_upsert_body(user_id=222),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body.get("code") == "AUTH_FORBIDDEN"
    assert "user_message" in body


@pytest.mark.asyncio
async def test_sellers_tg_upsert__matching_token__auth_passes(client: AsyncClient):
    """Token user_id == body.id → auth passes (403 check does not trigger)."""
    user_id = 999888
    token = _make_seller_token(user_id=user_id)

    # The repo.ensure_seller will be called with a MagicMock session.
    # The session.begin() context manager needs to be mocked properly.
    fake_seller = MagicMock()
    fake_seller.telegram_id = user_id
    fake_seller.brand_id = 1
    fake_seller.phone_e164 = "+79991234567"
    fake_seller.first_name = "Test"
    fake_seller.last_name = "User"
    fake_seller.city = None
    fake_seller.region = None
    fake_seller.outlet_name = None
    fake_seller.outlet_address = None
    fake_seller.outlet_chain = None
    fake_seller.outlet_inn = None
    fake_seller.position = None
    fake_seller.status = "pending"
    fake_seller.block_reason = None
    fake_seller.payout_kind = None
    fake_seller.payout_masked = None
    fake_seller.payout_encrypted = None
    fake_seller.consent_pdn_at = None
    fake_seller.created_at = datetime.now(UTC)
    fake_seller.updated_at = None
    fake_seller.created_by = None
    fake_seller.updated_by = None

    with patch(
        "src.seller.repository.SellerRepository.ensure_seller",
        new=AsyncMock(return_value=fake_seller),
    ):
        response = await client.post(
            f"{PREFIX}/tg-upsert",
            json=_tg_upsert_body(user_id=user_id),
            headers={"Authorization": f"Bearer {token}"},
        )

    # Auth should pass (no 401/403). If DB mock is insufficient → 500 is acceptable here
    # since we're only testing the auth layer, not the full DB integration.
    assert response.status_code not in (401, 403), (
        f"Expected auth to pass, got {response.status_code}: {response.json()}"
    )
