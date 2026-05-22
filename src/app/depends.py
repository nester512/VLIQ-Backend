from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.app.settings import Settings


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


async def get_pg_session(engine: Annotated[AsyncEngine, Depends(get_engine)]):
    async_session_maker = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()
