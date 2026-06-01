"""Rate limiting using SlowAPI + Redis backend (H6).

Limits applied per endpoint via @limiter.limit() decorator:
  - POST /auth/login        : 10/minute per IP
  - POST /auth/tma-verify   : 10/minute per IP
  - POST /sellers/tg-upsert : 5/minute per IP
  - POST /receipts/upload   : TODO — configure when OCR-agent adds the endpoint

Usage in route handlers:
    from src.app.middleware.rate_limit import limiter

    @router.post("/login")
    @limiter.limit("10/minute")
    async def login(request: Request, ...):
        ...

Note: SlowAPI requires 'request: Request' as first parameter in the handler for
the @limiter.limit() decorator to work correctly.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from src.app.settings import Settings

logger = logging.getLogger(__name__)

# Module-level singleton — configured via setup_rate_limiting().
# Import from here in route files: from src.app.middleware.rate_limit import limiter
limiter: Limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],  # No global default; limits are per-endpoint.
)


def get_limiter() -> Limiter:
    """Return the current module-level limiter instance."""
    return limiter


def setup_rate_limiting(app: FastAPI, cfg: Settings) -> None:
    """Wire SlowAPI limiter into the FastAPI app.

    Replaces the module-level limiter with a Redis-backed one when a REDIS_URL
    is configured. Falls back to in-memory storage when Redis is unavailable
    (useful for local dev without Redis).

    Must be called from create_app() so the exception handler is registered.
    """
    global limiter  # noqa: PLW0603

    storage_uri = cfg.REDIS_URL if cfg.REDIS_URL else None

    if storage_uri:
        limiter = Limiter(
            key_func=get_remote_address,
            storage_uri=storage_uri,
            default_limits=[],
            # Swallow errors when Redis is temporarily unavailable so the app
            # continues serving requests (degraded rate limiting, not outage).
            swallow_errors=True,
        )
        logger.info("rate_limit.setup.redis storage=%s", storage_uri)
    else:
        limiter = Limiter(
            key_func=get_remote_address,
            default_limits=[],
        )
        logger.info("rate_limit.setup.memory")

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
