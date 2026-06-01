"""Tests for bot startup modes (polling / webhook).

All tests are pure-unit: no network calls, no real Telegram token needed.
"""

from __future__ import annotations

import importlib
import sys
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _reload_bot_module(env_overrides: dict[str, str]) -> ModuleType:
    """Re-import src.bot.__main__ with the given environment overrides.

    Module-level globals (TG_BOT_TOKEN, BOT_MODE, …) are read at import time,
    so we must reload after patching os.environ.
    """
    mod_name = "src.bot.__main__"
    if mod_name in sys.modules:
        del sys.modules[mod_name]

    with patch.dict("os.environ", env_overrides, clear=False):
        module = importlib.import_module(mod_name)
    return module


# ---------------------------------------------------------------------------
# T5-A: handler registration
# ---------------------------------------------------------------------------


def test_register_handlers__binds_start_command() -> None:
    """register_handlers should attach /start and /help to the dispatcher."""
    from aiogram import Dispatcher

    mod = _reload_bot_module({"TG_BOT_TOKEN": "1:fake"})

    dp = Dispatcher()
    mod.register_handlers(dp)  # type: ignore[attr-defined]

    # aiogram 3 stores observers under dp.message.handlers (a list of FilteredHandlerWrapper)
    # We verify that *two* handlers were registered (start + help).
    handlers = dp.message.handlers
    assert len(handlers) == 2, f"Expected 2 handlers, got {len(handlers)}"


# ---------------------------------------------------------------------------
# T5-B: webhook aiohttp app structure
# ---------------------------------------------------------------------------


def test_webhook_app__builds_aiohttp_app() -> None:
    """build_webhook_app should return an aiohttp Application with the webhook route."""
    from aiogram import Bot, Dispatcher
    from aiohttp import web

    secret = "test-secret-abc123"
    env = {
        "TG_BOT_TOKEN": "1:fake",
        "BOT_MODE": "webhook",
        "BOT_WEBHOOK_HOST": "example.com",
        "BOT_WEBHOOK_SECRET": secret,
        "BOT_WEBHOOK_PORT": "8081",
    }
    mod = _reload_bot_module(env)

    bot = MagicMock(spec=Bot)
    dp = Dispatcher()
    mod.register_handlers(dp)  # type: ignore[attr-defined]

    app = mod.build_webhook_app(bot, dp)  # type: ignore[attr-defined]

    assert isinstance(app, web.Application)
    # The expected webhook path must be registered as a route.
    expected_path = f"/tg-webhook/{secret}"
    registered_paths = [r.resource.canonical for r in app.router.routes()]
    assert expected_path in registered_paths, (
        f"Expected route '{expected_path}' not found. Registered: {registered_paths}"
    )


# ---------------------------------------------------------------------------
# T5-C: webhook URL assembly
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("host", "secret", "expected"),
    [
        ("vliq.local", "abc123", "https://vliq.local/tg-webhook/abc123"),
        ("bot.example.com", "super-secret-xyz", "https://bot.example.com/tg-webhook/super-secret-xyz"),
    ],
)
def test_webhook_url__assembled_correctly(host: str, secret: str, expected: str) -> None:
    """_build_webhook_url should produce the right URL from env vars."""
    env = {
        "TG_BOT_TOKEN": "1:fake",
        "BOT_MODE": "webhook",
        "BOT_WEBHOOK_HOST": host,
        "BOT_WEBHOOK_SECRET": secret,
    }
    mod = _reload_bot_module(env)
    url = mod._build_webhook_url()  # type: ignore[attr-defined]
    assert url == expected, f"Got {url!r}, expected {expected!r}"
