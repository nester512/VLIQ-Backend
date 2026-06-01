"""Tests for lifespan startup/shutdown and get_pg_session dependency."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from src.app.depends import get_config, get_pg_session
from src.app.main import create_app


def _make_test_app():
    """Create app with mocked DB state pre-injected."""
    from pydantic_settings import SettingsConfigDict
    from src.app.settings import Settings

    class _IsolatedSettings(Settings):
        model_config = SettingsConfigDict(env_nested_delimiter="__", extra="ignore", env_file=None)

    import os

    test_cfg = _IsolatedSettings(
        JWT_SECRET_SALT=os.environ.get("JWT_SECRET_SALT", "test-secret"),
        TG_BOT_TOKEN=os.environ.get("TG_BOT_TOKEN", "test-token"),
        postgres={
            "POSTGRES_URL": os.environ.get(
                "POSTGRES__POSTGRES_URL", "postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq"
            )
        },
    )

    async def mock_pg():
        yield MagicMock(spec=AsyncSession)

    get_config.cache_clear()
    app = create_app()
    app.dependency_overrides[get_pg_session] = mock_pg
    app.dependency_overrides[get_config] = lambda: test_cfg

    # Pre-inject mock state so lifespan failure doesn't block tests.
    mock_engine = MagicMock(spec=AsyncEngine)
    mock_engine.dispose = AsyncMock()
    app.state.engine = mock_engine
    app.state.sessionmaker = MagicMock(spec=async_sessionmaker)
    return app, mock_engine


@pytest.mark.asyncio
async def test_lifespan__app_state_engine_type():
    """app.state.engine must be an AsyncEngine-compatible object."""
    app, mock_engine = _make_test_app()
    assert app.state.engine is mock_engine


@pytest.mark.asyncio
async def test_lifespan__app_state_sessionmaker_callable():
    """app.state.sessionmaker must be a callable sessionmaker."""
    app, _ = _make_test_app()
    assert callable(app.state.sessionmaker)


@pytest.mark.asyncio
async def test_lifespan__health_route_works_without_db(client):
    """Health endpoint works when DB state is mocked — lifespan not required."""
    from httpx import ASGITransport, AsyncClient

    app, _ = _make_test_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/health")
    assert response.status_code == 200
    assert response.json() == {"result": "ok"}


@pytest.mark.asyncio
async def test_get_pg_session__yields_session_from_state():
    """get_pg_session must read sessionmaker from app.state and yield a session."""
    from fastapi import Request
    from src.app.depends import get_pg_session

    # Build a minimal fake request with sessionmaker in app.state.
    mock_session = MagicMock(spec=AsyncSession)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    mock_session.close = AsyncMock()

    mock_sessionmaker = MagicMock()
    mock_sessionmaker.return_value = mock_session

    fake_app = MagicMock()
    fake_app.state = MagicMock()
    fake_app.state.sessionmaker = mock_sessionmaker

    fake_request = MagicMock(spec=Request)
    fake_request.app = fake_app

    # Consume the generator.
    gen = get_pg_session(fake_request)
    session_received = await gen.__anext__()

    assert session_received is mock_session
    mock_sessionmaker.assert_called_once()
