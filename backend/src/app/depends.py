from __future__ import annotations

from collections.abc import AsyncGenerator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.app.settings import Settings
from src.app.telegram_bot import TelegramBotClient


# H17: lru_cache prevents Settings() reconstruction on every request.
@lru_cache(maxsize=1)
def get_config() -> Settings:
    return Settings()


@lru_cache
def get_engine_by_dsn(dsn: str) -> AsyncEngine:
    return create_async_engine(
        dsn,
        echo=False,
        pool_size=20,
        pool_pre_ping=True,
        max_overflow=0,
        future=True,
    )


def get_engine(config: Annotated[Settings, Depends(get_config)]) -> AsyncEngine:
    return get_engine_by_dsn(config.postgres.POSTGRES_URL)


# H18: Session comes from app.state.sessionmaker (set in lifespan), no per-request factory.
async def get_pg_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    session_factory: async_sessionmaker[AsyncSession] = request.app.state.sessionmaker
    # `async with` already calls session.close() on exit — no need for explicit try/finally.
    async with session_factory() as session:
        yield session


def get_bot_client(request: Request) -> TelegramBotClient | None:
    """Return the TelegramBotClient from app.state (may be None if no TG_BOT_TOKEN)."""
    return getattr(request.app.state, "bot", None)
