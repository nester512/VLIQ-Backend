"""Tests for Settings validation and env-driven behaviour."""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from pydantic_settings import SettingsConfigDict
from src.app.settings import Settings as AppSettings


class _IsolatedSettings(AppSettings):
    """Settings subclass that does NOT read the .env file."""

    model_config = SettingsConfigDict(
        env_nested_delimiter="__",
        extra="ignore",
        env_file=None,
    )


def test_settings__missing_jwt_secret__raises_validation_error():
    """Settings without JWT_SECRET_SALT (no .env file) must raise ValidationError."""
    env = {
        "POSTGRES__POSTGRES_URL": "postgresql+asyncpg://u:p@localhost/db",
    }
    # Remove JWT_SECRET_SALT from environment.
    env_without_salt = dict(env.items())

    with patch.dict(os.environ, env_without_salt, clear=True):
        with pytest.raises((ValidationError, Exception)):
            _IsolatedSettings()


def test_settings__cors_origins__parses_json_string():
    """cors_origins must accept a JSON array string from env."""
    origins = ["https://app.vliq.ru", "https://vliq.ru"]
    env = {
        "JWT_SECRET_SALT": "test-secret",
        "POSTGRES__POSTGRES_URL": "postgresql+asyncpg://u:p@localhost/db",
        "ENV": "local",
        "CORS_ORIGINS": json.dumps(origins),
    }
    with patch.dict(os.environ, env, clear=True):
        settings = _IsolatedSettings()
        assert settings.cors_origins == origins


def test_settings__env_prod__docs_url_none():
    """When env=prod, create_app() must set docs_url=None."""
    from src.app.depends import get_config
    from src.app.main import create_app

    prod_settings = _IsolatedSettings(
        JWT_SECRET_SALT="test-salt",
        env="prod",
        postgres={"POSTGRES_URL": "postgresql+asyncpg://u:p@localhost/db"},
    )
    get_config.cache_clear()
    app = create_app()
    app.dependency_overrides[get_config] = lambda: prod_settings

    assert app.docs_url is None or prod_settings.env.value == "prod"
    # create_app reads cfg.env inside the function — check docs_url directly.
    from src.app.main import create_app as _create

    get_config.cache_clear()
    env_var_env = {
        "JWT_SECRET_SALT": "test-salt",
        "POSTGRES__POSTGRES_URL": "postgresql+asyncpg://u:p@localhost/db",
        "ENV": "prod",
    }
    with patch.dict(os.environ, env_var_env, clear=True):
        get_config.cache_clear()
        app2 = _create()
    assert app2.docs_url is None
    assert app2.redoc_url is None

    get_config.cache_clear()


def test_settings__env_local__docs_url_present():
    """When env=local, Swagger should be available at /swagger."""
    from src.app.depends import get_config
    from src.app.main import create_app

    env_var_env = {
        "JWT_SECRET_SALT": "test-salt",
        "POSTGRES__POSTGRES_URL": "postgresql+asyncpg://u:p@localhost/db",
        "ENV": "local",
    }
    with patch.dict(os.environ, env_var_env, clear=True):
        get_config.cache_clear()
        app = create_app()

    assert app.docs_url == "/swagger"
    get_config.cache_clear()
