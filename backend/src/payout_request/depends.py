"""Dependency injection helpers for payout_request module."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from redis.asyncio import Redis

from src.app.depends import get_config
from src.app.settings import Settings


async def get_redis(cfg: Annotated[Settings, Depends(get_config)]) -> Redis:
    """Return a Redis client. One client per request is fine for low-volume MVP.

    TODO (M): Move to app.state lifespan connection pool for production.
    """
    client = Redis.from_url(cfg.REDIS_URL, decode_responses=True)
    try:
        yield client
    finally:
        await client.aclose()
