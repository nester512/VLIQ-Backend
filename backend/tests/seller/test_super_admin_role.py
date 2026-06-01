"""Tests for super_admin role equivalence in the auth system (T5).

Verifies:
- require_admin accepts both "admin" and "super_admin" tokens.
- require_super_admin accepts only "super_admin" tokens.
- require_seller rejects both "admin" and "super_admin" tokens.
- super_admin has full access to admin-only endpoints (e.g. GET /sellers/{id}).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession
from src.admin.models import Admin, AdminRole
from src.app.auth import jwt as _jwt_module
from src.app.auth.jwt import jwt_auth
from src.app.errors import AppError
from src.seller.models import Seller, SellerStatus

PREFIX = "/api/v1/sellers"


# ---------------------------------------------------------------------------
# Token factories
# ---------------------------------------------------------------------------


def _make_token(role: str, user_id: int = 1001) -> str:
    now = datetime.now(UTC)
    payload = {
        "uid": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=6)).timestamp()),
        "user_id": user_id,
        "role": role,
    }
    return jwt.encode(payload, jwt_auth.secret, algorithm=jwt_auth.algorithm)


def _super_admin_token(user_id: int = 901) -> str:
    admin = MagicMock(spec=Admin)
    admin.telegram_id = user_id
    admin.role = AdminRole.super_admin
    admin.is_active = True
    return jwt_auth.create_token(admin)


def _admin_token(user_id: int = 900) -> str:
    admin = MagicMock(spec=Admin)
    admin.telegram_id = user_id
    admin.role = AdminRole.admin
    admin.is_active = True
    return jwt_auth.create_token(admin)


# ---------------------------------------------------------------------------
# Unit-level tests for require_admin / require_super_admin / require_seller
# ---------------------------------------------------------------------------


def _token_dict(role: str, user_id: int = 999) -> dict:
    """Build a minimal decoded JWT claims dict for direct dependency testing."""
    now = datetime.now(UTC)
    return {
        "uid": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=6)).timestamp()),
        "user_id": user_id,
        "role": role,
    }


def test_require_admin__accepts_admin_role():
    """require_admin must pass for 'admin' role."""
    token = _token_dict("admin")
    result = _jwt_module.require_admin(token)  # type: ignore[arg-type]
    assert result["role"] == "admin"


def test_require_admin__accepts_super_admin_role():
    """require_admin must pass for 'super_admin' (strict superset of admin)."""
    token = _token_dict("super_admin")
    result = _jwt_module.require_admin(token)  # type: ignore[arg-type]
    assert result["role"] == "super_admin"


def test_require_admin__rejects_seller_role():
    """require_admin must raise AppError(AUTH_FORBIDDEN) for 'seller' role."""
    token = _token_dict("seller")
    with pytest.raises(AppError) as exc_info:
        _jwt_module.require_admin(token)  # type: ignore[arg-type]
    assert exc_info.value.code == "AUTH_FORBIDDEN"
    assert exc_info.value.status_code == 403


def test_require_super_admin__accepts_super_admin_role():
    """require_super_admin must pass for 'super_admin' role."""
    token = _token_dict("super_admin")
    result = _jwt_module.require_super_admin(token)  # type: ignore[arg-type]
    assert result["role"] == "super_admin"


def test_require_super_admin__rejects_admin_role():
    """require_super_admin must reject plain 'admin' (not a superset of super_admin)."""
    token = _token_dict("admin")
    with pytest.raises(AppError) as exc_info:
        _jwt_module.require_super_admin(token)  # type: ignore[arg-type]
    assert exc_info.value.code == "AUTH_FORBIDDEN"
    assert exc_info.value.status_code == 403


def test_require_super_admin__rejects_seller_role():
    """require_super_admin must reject 'seller' role."""
    token = _token_dict("seller")
    with pytest.raises(AppError) as exc_info:
        _jwt_module.require_super_admin(token)  # type: ignore[arg-type]
    assert exc_info.value.code == "AUTH_FORBIDDEN"
    assert exc_info.value.status_code == 403


def test_require_seller__rejects_super_admin_role():
    """require_seller must reject 'super_admin' (seller endpoints are seller-only)."""
    token = _token_dict("super_admin")
    with pytest.raises(AppError) as exc_info:
        _jwt_module.require_seller(token)  # type: ignore[arg-type]
    assert exc_info.value.code == "AUTH_FORBIDDEN"
    assert exc_info.value.status_code == 403


def test_require_seller__rejects_admin_role():
    """require_seller must reject 'admin' role."""
    token = _token_dict("admin")
    with pytest.raises(AppError) as exc_info:
        _jwt_module.require_seller(token)  # type: ignore[arg-type]
    assert exc_info.value.code == "AUTH_FORBIDDEN"
    assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# Integration tests — super_admin vs admin-only HTTP endpoints
# ---------------------------------------------------------------------------


def _make_seller_mock(telegram_id: int = 12345) -> MagicMock:
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
    seller.outlet_chain = None
    seller.outlet_inn = None
    seller.position = None
    seller.status = SellerStatus.active
    seller.block_reason = None
    seller.payout_kind = None
    seller.payout_masked = None
    seller.consent_pdn_at = None
    seller.created_at = datetime(2024, 1, 1, 12, 0, 0)
    seller.updated_at = None
    seller.created_by = None
    seller.updated_by = None
    return seller


@pytest.mark.asyncio
async def test_super_admin__has_admin_access(client: AsyncClient, app):
    """super_admin token must be accepted by admin-only endpoints (GET /sellers/{id})."""
    mock_seller = _make_seller_mock(telegram_id=12345)
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_seller

    session_mock = MagicMock(spec=AsyncSession)
    session_mock.execute = AsyncMock(return_value=mock_result)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session  # noqa: PLC0415

    app.dependency_overrides[get_pg_session] = _override

    response = await client.get(
        f"{PREFIX}/12345",
        headers={"Authorization": f"Bearer {_super_admin_token()}"},
    )

    assert response.status_code == 200, (
        f"super_admin should access admin endpoint, got {response.status_code}: {response.json()}"
    )
    body = response.json()
    assert body["telegram_id"] == 12345


@pytest.mark.asyncio
async def test_super_admin__seller_endpoint_returns_403(client: AsyncClient):
    """super_admin token must be rejected by seller-only endpoints (POST /sellers/tg-upsert)."""
    response = await client.post(
        f"{PREFIX}/tg-upsert",
        json={
            "id": 12345,
            "brand_id": 1,
            "phone_e164": "+79991234567",
            "first_name": "Test",
            "last_name": "User",
        },
        headers={"Authorization": f"Bearer {_super_admin_token()}"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body.get("code") == "AUTH_FORBIDDEN"
