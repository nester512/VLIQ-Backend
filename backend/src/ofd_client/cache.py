"""OFD response cache — Redis (production) and in-memory (tests).

Key scheme: ``ofd:{fn}:{fd}:{fp}``
Default TTL: 24 hours (receipts are immutable once in OFD).
"""

from __future__ import annotations

import json
import logging
from typing import Protocol, runtime_checkable

from src.ofd_client.schemas import OFDReceipt

logger = logging.getLogger(__name__)

_DEFAULT_TTL_SECONDS = 86_400  # 24 hours


def _cache_key(fn: str, fd: str, fp: str) -> str:
    return f"ofd:{fn}:{fd}:{fp}"


@runtime_checkable
class OFDCache(Protocol):
    """Protocol for OFD receipt cache backends."""

    async def get(self, fn: str, fd: str, fp: str) -> OFDReceipt | None:
        """Return cached OFDReceipt or ``None`` if not cached."""
        ...

    async def set(
        self,
        fn: str,
        fd: str,
        fp: str,
        receipt: OFDReceipt,
        ttl: int = _DEFAULT_TTL_SECONDS,
    ) -> None:
        """Store *receipt* under the (fn, fd, fp) key with given *ttl* seconds."""
        ...


class RedisOFDCache:
    """Redis-backed OFD cache using redis.asyncio.

    Args:
        redis_url: Redis connection URL, e.g. ``redis://localhost:6379/0``.
    """

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._redis: object | None = None  # lazy connection

    async def _get_redis(self):  # type: ignore[return]
        """Return a lazily-created redis.asyncio.Redis instance."""
        if self._redis is None:
            try:
                from redis.asyncio import Redis  # noqa: PLC0415
            except ImportError as exc:
                raise ImportError(
                    'redis[hiredis] is required for RedisOFDCache. Install with: poetry add "redis[hiredis]"'
                ) from exc
            self._redis = Redis.from_url(self._redis_url, decode_responses=True)
        return self._redis

    async def get(self, fn: str, fd: str, fp: str) -> OFDReceipt | None:
        redis = await self._get_redis()
        key = _cache_key(fn, fd, fp)
        try:
            raw = await redis.get(key)
        except Exception as exc:
            logger.warning("ofd_cache.redis_get_error, key=%s: %s", key, exc)
            return None
        if raw is None:
            return None
        try:
            data = json.loads(raw)
            receipt = OFDReceipt.model_validate(data)
            logger.debug("ofd_cache.hit, fn=%s fd=%s fp=%s", fn, fd, fp)
            return receipt
        except Exception as exc:
            logger.warning("ofd_cache.deserialize_error, key=%s: %s", key, exc)
            return None

    async def set(
        self,
        fn: str,
        fd: str,
        fp: str,
        receipt: OFDReceipt,
        ttl: int = _DEFAULT_TTL_SECONDS,
    ) -> None:
        redis = await self._get_redis()
        key = _cache_key(fn, fd, fp)
        try:
            payload = receipt.model_dump_json()
            await redis.set(key, payload, ex=ttl)
            logger.debug("ofd_cache.set, fn=%s fd=%s fp=%s, ttl=%ds", fn, fd, fp, ttl)
        except Exception as exc:
            # Cache write failure is non-fatal — log and continue.
            logger.warning("ofd_cache.redis_set_error, key=%s: %s", key, exc)


class InMemoryOFDCache:
    """Simple in-memory OFD cache for unit tests.

    No TTL enforcement — all entries live for the lifetime of the object.
    """

    def __init__(self) -> None:
        self._store: dict[str, OFDReceipt] = {}

    async def get(self, fn: str, fd: str, fp: str) -> OFDReceipt | None:
        key = _cache_key(fn, fd, fp)
        receipt = self._store.get(key)
        if receipt:
            logger.debug("ofd_cache.memory_hit, fn=%s fd=%s fp=%s", fn, fd, fp)
        return receipt

    async def set(
        self,
        fn: str,
        fd: str,
        fp: str,
        receipt: OFDReceipt,
        ttl: int = _DEFAULT_TTL_SECONDS,
    ) -> None:
        key = _cache_key(fn, fd, fp)
        self._store[key] = receipt
        logger.debug("ofd_cache.memory_set, fn=%s fd=%s fp=%s", fn, fd, fp)

    def clear(self) -> None:
        """Clear all cached entries (test helper)."""
        self._store.clear()
