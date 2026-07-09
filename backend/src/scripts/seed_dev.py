"""Idempotent seed script.

Always applies the CORE seed (seed_dev.sql: brand + admins + cities) and —
only when the ``SEED_DEMO`` env flag is truthy — the DEMO seed
(seed_demo.sql: sellers / receipts / payouts / promotions / notifications).

The split exists because the backend container runs this script on EVERY
start: without the flag a production restart kept re-creating demo sellers
and unverifiable ``seed://`` receipts in the admin review queue.

Safe to re-run — all statements use ON CONFLICT DO NOTHING / DO UPDATE,
and demo rows are purged+reinserted.

Usage (inside the backend container):
    python -m src.scripts.seed_dev              # core only
    SEED_DEMO=true python -m src.scripts.seed_dev  # core + demo
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_TRUTHY = {"1", "true", "yes", "on"}

# The seed files live next to src/ in the backend dir — parents[2] of this
# file both on the host (backend/) and in the container (WORKDIR=/app).
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_CORE_CANDIDATES = (
    _BACKEND_DIR / "seed_dev.sql",
    Path("/app/seed_dev.sql"),
)
_DEMO_CANDIDATES = (
    _BACKEND_DIR / "seed_demo.sql",
    Path("/app/seed_demo.sql"),
)


def demo_seed_enabled(env: dict[str, str] | None = None) -> bool:
    """Return True when the SEED_DEMO env flag is truthy (default: off)."""
    value = (env if env is not None else os.environ).get("SEED_DEMO", "")
    return value.strip().lower() in _TRUTHY


def _find_file(candidates: tuple[Path, ...]) -> Path:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"seed file not found at any of {[str(c) for c in candidates]}. "
        "Make sure WORKDIR is set to /app and the file is copied into the image."
    )


def seed_files() -> list[Path]:
    """Resolve the seed files to apply: core always, demo behind SEED_DEMO."""
    files = [_find_file(_CORE_CANDIDATES)]
    if demo_seed_enabled():
        files.append(_find_file(_DEMO_CANDIDATES))
    return files


async def run_seed() -> None:
    import asyncpg

    pg_url = os.environ.get("POSTGRES__POSTGRES_URL", "")
    if not pg_url:
        raise RuntimeError("POSTGRES__POSTGRES_URL is not set")

    # asyncpg uses postgresql:// scheme (not postgresql+asyncpg://)
    dsn = pg_url.replace("postgresql+asyncpg://", "postgresql://")

    files = seed_files()
    if not demo_seed_enabled():
        logger.info("seed_dev: SEED_DEMO is off — applying core seed only")

    conn = await asyncpg.connect(dsn=dsn)
    try:
        for seed_file in files:
            await conn.execute(seed_file.read_text(encoding="utf-8"))
            logger.info("seed_dev: seed applied from %s", seed_file)
    finally:
        await conn.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_seed())


if __name__ == "__main__":
    main()
