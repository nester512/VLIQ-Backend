"""Idempotent dev-seed script.

Reads seed_dev.sql relative to the project root and runs it via asyncpg.
Safe to re-run — all statements use ON CONFLICT DO NOTHING / DO UPDATE,
and demo rows are purged+reinserted.

Usage (inside the backend container):
    python -m src.scripts.seed_dev
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# Path to the SQL file (one level above the backend/ directory, in the repo root).
_SEED_SQL = Path(__file__).resolve().parents[3] / "backend" / "seed_dev.sql"
# Fallback: same directory as backend/ when run inside the container where WORKDIR=/app
_SEED_SQL_ALT = Path("/app/seed_dev.sql")


def _find_seed_file() -> Path:
    for candidate in (_SEED_SQL, _SEED_SQL_ALT):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"seed_dev.sql not found at {_SEED_SQL} or {_SEED_SQL_ALT}. "
        "Make sure WORKDIR is set to /app and the file is copied into the image."
    )


async def run_seed() -> None:
    import asyncpg

    pg_url = os.environ.get("POSTGRES__POSTGRES_URL", "")
    if not pg_url:
        raise RuntimeError("POSTGRES__POSTGRES_URL is not set")

    # asyncpg uses postgresql:// scheme (not postgresql+asyncpg://)
    dsn = pg_url.replace("postgresql+asyncpg://", "postgresql://")

    seed_file = _find_seed_file()
    sql = seed_file.read_text(encoding="utf-8")

    conn = await asyncpg.connect(dsn=dsn)
    try:
        await conn.execute(sql)
        logger.info("seed_dev: seed applied from %s", seed_file)
    finally:
        await conn.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_seed())


if __name__ == "__main__":
    main()
