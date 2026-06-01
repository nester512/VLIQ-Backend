"""Root conftest — shared fixtures for all test suites."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock
from urllib.parse import urlencode

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Environment must be set BEFORE any application module is imported.
# ---------------------------------------------------------------------------
_TEST_BOT_TOKEN = "1234567890:test-bot-token-for-hmac"
_TEST_JWT_SALT = "test-secret-salt"
# Tests run against a SEPARATE database so destructive migration suites
# (alembic downgrade base, DROP SCHEMA CASCADE) don't wipe the dev/live data.
# Override via TEST_PG_URL env if you've provisioned a different test DB.
_TEST_PG_URL = os.environ.get(
    "TEST_PG_URL",
    "postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq_test",
)

os.environ["JWT_SECRET_SALT"] = _TEST_JWT_SALT
os.environ["TG_BOT_TOKEN"] = _TEST_BOT_TOKEN
os.environ["POSTGRES__POSTGRES_URL"] = _TEST_PG_URL
os.environ["ENV"] = "local"
os.environ["CORS_ORIGINS"] = "[]"

# ---------------------------------------------------------------------------
# Import application after env is configured.
# ---------------------------------------------------------------------------
from src.app.depends import get_config, get_pg_session  # noqa: E402

# Clear any previously cached settings (e.g. from earlier pytest session).
get_config.cache_clear()

from src.app.main import create_app  # noqa: E402
from src.app.settings import Settings  # noqa: E402


def _make_test_settings(**kwargs) -> Settings:
    """Build Settings from env vars only (no .env file)."""
    # Override get_config to return Settings built from current environment.
    from pydantic_settings import SettingsConfigDict

    class _IsolatedSettings(Settings):
        model_config = SettingsConfigDict(
            env_nested_delimiter="__",
            extra="ignore",
            env_file=None,  # Do NOT read .env file in tests
        )

    return _IsolatedSettings()


# ---------------------------------------------------------------------------
# Mock DB session — used as FastAPI dependency override.
# ---------------------------------------------------------------------------


async def _mock_get_pg_session() -> AsyncGenerator[MagicMock, None]:
    """Dependency override that yields a mock session without touching the DB."""
    session = MagicMock(spec=AsyncSession)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.close = AsyncMock()
    yield session


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def bot_token() -> str:
    """Known bot token used to produce HMAC signatures in auth tests."""
    return _TEST_BOT_TOKEN


@pytest.fixture(scope="session")
def mock_telegram_bot_token(bot_token: str) -> str:
    return bot_token


def _build_init_data(user_id: int, bot_token: str, auth_date: int | None = None) -> str:
    """Build a valid Telegram WebApp initData string with correct HMAC."""
    import time

    if auth_date is None:
        auth_date = int(time.time())

    user_json = json.dumps({"id": user_id, "first_name": "Test", "last_name": "User"})
    params: dict[str, str] = {
        "auth_date": str(auth_date),
        "user": user_json,
    }

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))
    # Telegram spec: HMAC-SHA256(key=b"WebAppData", msg=bot_token)
    secret_key = hmac.new(
        key=b"WebAppData",
        msg=bot_token.encode(),
        digestmod=hashlib.sha256,
    ).digest()
    signature = hmac.new(
        key=secret_key,
        msg=data_check_string.encode(),
        digestmod=hashlib.sha256,
    ).hexdigest()

    params["hash"] = signature
    return urlencode(params)


@pytest.fixture(scope="session")
def valid_init_data(bot_token: str) -> str:
    """Valid initData for user_id=999999."""
    return _build_init_data(user_id=999999, bot_token=bot_token)


@pytest.fixture
def test_settings() -> Settings:
    """Settings instance built from env without .env file."""
    get_config.cache_clear()
    s = _make_test_settings()
    return s


@pytest.fixture
def app(test_settings: Settings):
    """FastAPI app with mocked DB and controlled Settings."""
    get_config.cache_clear()
    application = create_app()
    # Override dependencies.
    application.dependency_overrides[get_pg_session] = _mock_get_pg_session
    application.dependency_overrides[get_config] = lambda: test_settings
    return application


@pytest_asyncio.fixture()
async def client(app):
    """Async HTTP client backed by ASGITransport.

    The lifespan is triggered but fails gracefully since get_pg_session is overridden.
    We pre-set app.state to avoid KeyError from the lifespan failure.
    """
    from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

    mock_engine = MagicMock(spec=AsyncEngine)
    mock_engine.dispose = AsyncMock()
    app.state.engine = mock_engine
    app.state.sessionmaker = MagicMock(spec=async_sessionmaker)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
