"""Tests for global exception handlers (H20)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic_settings import SettingsConfigDict
from src.app.settings import Settings


class _IsolatedSettings(Settings):
    model_config = SettingsConfigDict(env_nested_delimiter="__", extra="ignore", env_file=None)


def _build_bare_app(env: str = "local") -> FastAPI:
    """Build a minimal FastAPI app directly using setup_* functions with controlled cfg."""
    from src.app.main import setup_exception_handlers, setup_middleware

    cfg = _IsolatedSettings(
        JWT_SECRET_SALT="test-salt",
        TG_BOT_TOKEN="test-token",
        env=env,
        postgres={"POSTGRES_URL": "postgresql+asyncpg://u:p@localhost/db"},
    )

    app = FastAPI()
    setup_middleware(app, cfg)
    setup_exception_handlers(app, cfg)

    @app.get("/_test/boom")
    async def boom():
        raise RuntimeError("intentional test error")

    @app.post("/_test/bad-json")
    async def bad_json_endpoint(body: dict):
        return body

    return app


@pytest.mark.asyncio
async def test_validation_error__returns_422_with_envelope(client: AsyncClient):
    """Invalid JSON body on any endpoint → 422 with envelope keys."""
    response = await client.post(
        "/api/v1/auth/tma-verify",
        content=b"not-json-at-all",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body.get("code") == "VALIDATION_ERROR"
    assert "user_message" in body
    assert "debug_id" in body


@pytest.mark.asyncio
async def test_unhandled_exception__prod_env__no_traceback():
    """In prod env, internal 500 must not expose traceback."""
    app = _build_bare_app(env="prod")

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as ac:
        response = await ac.get("/_test/boom")

    assert response.status_code == 500
    body = response.json()
    assert "traceback" not in body
    assert body.get("code") == "INTERNAL_ERROR"
    assert "user_message" in body
    assert "debug_id" in body


@pytest.mark.asyncio
async def test_unhandled_exception__local_env__traceback_visible():
    """In local env, internal 500 must include traceback field."""
    app = _build_bare_app(env="local")

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as ac:
        response = await ac.get("/_test/boom")

    assert response.status_code == 500
    body = response.json()
    assert body.get("code") == "INTERNAL_ERROR"
    assert "traceback" in body
    assert "RuntimeError" in body["traceback"]
