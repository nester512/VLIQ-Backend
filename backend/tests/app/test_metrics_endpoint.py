"""Tests for the Prometheus /metrics endpoint.

Verifies that:
  - The endpoint exists and returns 200.
  - The response content-type is Prometheus text exposition format.
  - Core VLIQ custom metrics are present in the output.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from src.app.main import create_app


@pytest.fixture
def metrics_app():
    """Minimal app with mocked DB state — same pattern as test_lifespan.py."""
    import os
    from unittest.mock import AsyncMock, MagicMock

    from pydantic_settings import SettingsConfigDict
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
    from src.app.depends import get_config, get_pg_session
    from src.app.settings import Settings

    class _IsolatedSettings(Settings):
        model_config = SettingsConfigDict(env_nested_delimiter="__", extra="ignore", env_file=None)

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

    mock_engine = MagicMock(spec=AsyncEngine)
    mock_engine.dispose = AsyncMock()
    app.state.engine = mock_engine
    app.state.sessionmaker = MagicMock(spec=async_sessionmaker)
    return app


@pytest.mark.asyncio
async def test_metrics_endpoint__returns_prometheus_text(metrics_app):
    """/metrics must return 200 with Prometheus text exposition content-type."""
    async with AsyncClient(transport=ASGITransport(app=metrics_app), base_url="http://test") as ac:
        response = await ac.get("/metrics")

    assert response.status_code == 200
    content_type = response.headers.get("content-type", "")
    assert "text/plain" in content_type or "application/openmetrics-text" in content_type


@pytest.mark.asyncio
async def test_metrics_endpoint__contains_custom_vliq_metrics(metrics_app):
    """/metrics output must include VLIQ-specific metric names."""
    async with AsyncClient(transport=ASGITransport(app=metrics_app), base_url="http://test") as ac:
        response = await ac.get("/metrics")

    body = response.text
    assert "ofd_requests_total" in body
    assert "ofd_request_duration_seconds" in body
    assert "receipt_pipeline_duration_seconds" in body
    assert "notification_outbox_pending" in body
    assert "notification_outbox_dead" in body


@pytest.mark.asyncio
async def test_metrics_endpoint__contains_http_instrumentation(metrics_app):
    """/metrics must include http_requests_total from prometheus-fastapi-instrumentator."""
    async with AsyncClient(transport=ASGITransport(app=metrics_app), base_url="http://test") as ac:
        # Make one health request so the counter initialises.
        await ac.get("/health")
        response = await ac.get("/metrics")

    assert "http_requests_total" in response.text
