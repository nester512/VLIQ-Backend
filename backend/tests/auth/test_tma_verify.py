"""Tests for POST /auth/tma-verify — HMAC verification and JWT issuance.

These tests run against the ASGI app without a real database.
The endpoint reaches the DB only after HMAC is verified, so we can unit-test
the auth layer by mocking `_issue_token_for_telegram_id`.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock, patch
from urllib.parse import urlencode

import pytest
from httpx import AsyncClient
from src.auth.schemas.api import LoginResponse

from tests.conftest import _build_init_data

PREFIX = "/api/v1/auth"


def _build_bad_init_data(user_id: int = 111) -> str:
    """initData with a wrong hash value."""
    user_json = json.dumps({"id": user_id, "first_name": "Evil"})
    params = {
        "auth_date": str(int(time.time())),
        "user": user_json,
        "hash": "deadbeef" * 8,  # wrong hash
    }
    return urlencode(params)


def _build_missing_hash_init_data(user_id: int = 111) -> str:
    """initData without 'hash' field."""
    user_json = json.dumps({"id": user_id})
    params = {
        "auth_date": str(int(time.time())),
        "user": user_json,
    }
    return urlencode(params)


def _build_missing_user_init_data(bot_token: str) -> str:
    """Valid hash but no 'user' field (using handler's key/msg order)."""
    params = {"auth_date": str(int(time.time()))}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))
    # Telegram spec: HMAC-SHA256(key=b"WebAppData", msg=bot_token)
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    signature = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    params["hash"] = signature
    return urlencode(params)


@pytest.mark.asyncio
async def test_tma_verify__valid_hmac__returns_200_and_jwt(client: AsyncClient, bot_token: str):
    """Happy path: valid initData → 200, access_token present in body."""
    init_data = _build_init_data(user_id=999999, bot_token=bot_token)

    fake_response = LoginResponse(access_token="fake.jwt.token", role="seller")

    with patch(
        "src.auth.handlers.api.v1.router._issue_token_for_telegram_id",
        new=AsyncMock(return_value=fake_response),
    ):
        response = await client.post(f"{PREFIX}/tma-verify", json={"init_data": init_data})

    assert response.status_code == 200
    body = response.json()
    assert "access_token" in body
    assert body["access_token"] == "fake.jwt.token"
    assert body["role"] == "seller"


@pytest.mark.asyncio
async def test_tma_verify__bad_hash__returns_401(client: AsyncClient):
    """Wrong HMAC signature → 401 Unauthorized."""
    init_data = _build_bad_init_data(user_id=111)
    response = await client.post(f"{PREFIX}/tma-verify", json={"init_data": init_data})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_tma_verify__missing_hash_field__returns_400(client: AsyncClient):
    """init_data without 'hash' key → 400 Bad Request."""
    init_data = _build_missing_hash_init_data(user_id=111)
    response = await client.post(f"{PREFIX}/tma-verify", json={"init_data": init_data})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_tma_verify__missing_init_data_field__returns_422(client: AsyncClient):
    """Body without 'init_data' field → 422 Unprocessable Entity with envelope."""
    response = await client.post(f"{PREFIX}/tma-verify", json={})
    assert response.status_code == 422
    body = response.json()
    assert body.get("code") == "VALIDATION_ERROR"
    assert "user_message" in body
    assert "debug_id" in body


@pytest.mark.asyncio
async def test_tma_verify__missing_user_field__returns_400(client: AsyncClient, bot_token: str):
    """init_data with valid hash but no 'user' key → 400 Bad Request."""
    init_data = _build_missing_user_init_data(bot_token)
    response = await client.post(f"{PREFIX}/tma-verify", json={"init_data": init_data})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_login__dev_env__returns_non_404(client: AsyncClient):
    """In local/dev env (default in tests), /auth/login should NOT return 404."""
    # We send invalid body on purpose to get 422, proving the route is mounted.
    response = await client.post(f"{PREFIX}/login", json={})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login__prod_env__returns_404(bot_token: str):
    """In prod env, /auth/login must return 404."""

    from unittest.mock import AsyncMock, MagicMock

    from httpx import ASGITransport, AsyncClient
    from pydantic_settings import SettingsConfigDict
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
    from src.app.depends import get_config, get_pg_session
    from src.app.main import create_app
    from src.app.settings import Settings

    class ProdSettings(Settings):
        model_config = SettingsConfigDict(env_nested_delimiter="__", extra="ignore", env_file=None)

    prod_settings = ProdSettings(
        JWT_SECRET_SALT="test-salt",
        TG_BOT_TOKEN=bot_token,
        env="prod",
        postgres={"POSTGRES_URL": "postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq"},
    )

    async def mock_pg_session():
        yield MagicMock(spec=AsyncSession)

    prod_app = create_app()
    prod_app.dependency_overrides[get_pg_session] = mock_pg_session
    prod_app.dependency_overrides[get_config] = lambda: prod_settings

    mock_engine = MagicMock(spec=AsyncEngine)
    mock_engine.dispose = AsyncMock()
    prod_app.state.engine = mock_engine
    prod_app.state.sessionmaker = MagicMock(spec=async_sessionmaker)

    async with AsyncClient(transport=ASGITransport(app=prod_app), base_url="http://test") as ac:
        response = await ac.post(f"{PREFIX}/login", json={"id": 1})
    assert response.status_code == 404
