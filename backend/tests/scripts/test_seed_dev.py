"""Tests for the SEED_DEMO split in src/scripts/seed_dev.py.

Core seed (brand/admins/cities) must always apply; the demo seed
(sellers/receipts/...) only behind the SEED_DEMO flag — a production restart
must never re-create demo sellers or seed:// receipts.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from src.scripts.seed_dev import demo_seed_enabled, seed_files

_BACKEND_DIR = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["1", "true", "True", "TRUE", "yes", "on", " true "])
def test_demo_seed_enabled_truthy(value: str) -> None:
    assert demo_seed_enabled({"SEED_DEMO": value}) is True


@pytest.mark.parametrize("value", ["", "0", "false", "no", "off", "prod", "None"])
def test_demo_seed_enabled_falsy(value: str) -> None:
    assert demo_seed_enabled({"SEED_DEMO": value}) is False


def test_demo_seed_disabled_when_unset() -> None:
    assert demo_seed_enabled({}) is False


# ---------------------------------------------------------------------------
# File resolution
# ---------------------------------------------------------------------------


def test_core_only_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEED_DEMO", raising=False)
    files = seed_files()
    assert [f.name for f in files] == ["seed_dev.sql"]


def test_core_plus_demo_when_flag_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SEED_DEMO", "true")
    files = seed_files()
    assert [f.name for f in files] == ["seed_dev.sql", "seed_demo.sql"]


# ---------------------------------------------------------------------------
# Content guards — keep the split honest as the files evolve.
# ---------------------------------------------------------------------------


def _sql_without_comments(path: Path) -> str:
    """SQL body with `--` comment lines stripped — guards match real statements only."""
    lines = path.read_text(encoding="utf-8").splitlines()
    return "\n".join(line for line in lines if not line.lstrip().startswith("--")).lower()


def test_core_seed_has_no_demo_rows() -> None:
    """Core seed must not touch seller/receipt/payout/promotion tables."""
    core = _sql_without_comments(_BACKEND_DIR / "seed_dev.sql")
    for table in ("vliq.seller", "vliq.receipt", "vliq.payout_request", "vliq.promotion", "seed://"):
        assert table not in core, f"demo artifact {table!r} leaked into core seed_dev.sql"


def test_core_seed_keeps_required_system_rows() -> None:
    core = (_BACKEND_DIR / "seed_dev.sql").read_text(encoding="utf-8")
    assert "vliq.brand" in core
    assert "vliq.admin" in core
    assert "vliq.city" in core
    # Owner admin must survive every restart (see seed comment).
    assert "997459169" in core


def test_core_seed_has_no_dev_only_admins() -> None:
    """A test deploy must never recreate the disposable 99998/99999 identities."""
    core = _sql_without_comments(_BACKEND_DIR / "seed_dev.sql")
    assert "99998" not in core
    assert "99999" not in core


def test_demo_seed_has_no_admin_or_brand_rows() -> None:
    """Demo seed must not (re)define system rows — that is core's job."""
    demo = (_BACKEND_DIR / "seed_demo.sql").read_text(encoding="utf-8").lower()
    assert "into vliq.admin" not in demo
    assert "into vliq.brand" not in demo
    assert "into vliq.city" not in demo
    # And it is the only place for the demo sellers.
    assert "12345" in demo
