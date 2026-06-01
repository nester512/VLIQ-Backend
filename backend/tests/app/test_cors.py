"""Tests for CORS middleware configuration (B4)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic_settings import SettingsConfigDict
from src.app.main import setup_middleware
from src.app.settings import Settings


class _IsolatedSettings(Settings):
    model_config = SettingsConfigDict(env_nested_delimiter="__", extra="ignore", env_file=None)


def _base_cfg(**overrides) -> _IsolatedSettings:
    defaults = {
        "JWT_SECRET_SALT": "test-salt",
        "TG_BOT_TOKEN": "test-token",
        "env": "local",
        "postgres": {"POSTGRES_URL": "postgresql+asyncpg://u:p@localhost/db"},
    }
    defaults.update(overrides)
    return _IsolatedSettings(**defaults)


def _make_cors_app(cors_origins: list[str]):
    """Create a minimal app with given cors_origins via setup_middleware."""
    from fastapi import FastAPI

    cfg = _base_cfg(cors_origins=cors_origins)
    app = FastAPI()
    setup_middleware(app, cfg)

    @app.get("/health")
    async def health():
        return {"result": "ok"}

    return app


@pytest.mark.asyncio
async def test_cors__empty_origins__wildcard_no_credentials():
    """When cors_origins=[], middleware uses wildcard — allow_credentials=False."""
    app = _make_cors_app([])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.options(
            "/health",
            headers={
                "Origin": "http://evil.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
    acao = response.headers.get("access-control-allow-origin", "")
    # With wildcard, either * or empty (no pre-flight needed for simple requests).
    assert acao in {"*", ""}

    # allow_credentials must be False/absent when using wildcard.
    acac = response.headers.get("access-control-allow-credentials", "false")
    assert acac.lower() != "true"


@pytest.mark.asyncio
async def test_cors__explicit_origins__allow_credentials_true():
    """When cors_origins has values, allow_credentials=True and origin is echoed."""
    allowed_origin = "http://localhost:5173"
    app = _make_cors_app([allowed_origin])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.options(
            "/health",
            headers={
                "Origin": allowed_origin,
                "Access-Control-Request-Method": "GET",
            },
        )

    acao = response.headers.get("access-control-allow-origin", "")
    acac = response.headers.get("access-control-allow-credentials", "")

    assert acao == allowed_origin
    assert acac.lower() == "true"


@pytest.mark.asyncio
async def test_cors__disallowed_origin__not_echoed():
    """Origin not in cors_origins must not be echoed in ACAO header."""
    allowed_origin = "http://localhost:5173"
    disallowed_origin = "http://evil.example.com"
    app = _make_cors_app([allowed_origin])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.options(
            "/health",
            headers={
                "Origin": disallowed_origin,
                "Access-Control-Request-Method": "GET",
            },
        )

    acao = response.headers.get("access-control-allow-origin", "")
    assert acao != disallowed_origin
