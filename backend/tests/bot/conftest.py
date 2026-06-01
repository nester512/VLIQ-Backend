"""Conftest for bot tests.

Bot tests are fully isolated from the FastAPI app — they only need TG_BOT_TOKEN
set so that the bot module can be imported without raising RuntimeError.
This conftest sets minimal env vars and does NOT import src.app.main, avoiding
dependencies on optional packages (prometheus_fastapi_instrumentator, etc.).
"""

from __future__ import annotations

import os

# Minimal env so src.bot.__main__ can be imported cleanly.
os.environ.setdefault("TG_BOT_TOKEN", "1:fake-token-for-tests")
os.environ.setdefault("BOT_MODE", "polling")
