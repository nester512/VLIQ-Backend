"""Unit tests for the pure parts of seller stats: risk level, risk flags, DTO mapping."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from src.seller.services import stats_service as svc
from src.seller.services.stats_service import build_stats, risk_flags, risk_level


@pytest.mark.parametrize(
    ("score", "level"),
    [
        (0, "low"),
        (svc.RISK_MEDIUM - 1, "low"),
        (svc.RISK_MEDIUM, "medium"),
        (svc.RISK_HIGH - 1, "medium"),
        (svc.RISK_HIGH, "high"),
        (100, "high"),
    ],
)
def test_risk_level__thresholds(score: int, level: str) -> None:
    assert risk_level(score) == level


def test_risk_flags__few_decisions__low_data_only() -> None:
    # 4 decisions < RISK_MIN_DECISIONS: reject rate is noise, not a "high reject" flag.
    assert risk_flags(total=4, approved=0, rejected=4, duplicates=0) == ["low_data"]


def test_risk_flags__high_reject_rate() -> None:
    assert risk_flags(total=10, approved=6, rejected=4, duplicates=0) == ["high_reject_rate"]


def test_risk_flags__reject_rate_below_threshold__no_flag() -> None:
    assert risk_flags(total=10, approved=8, rejected=2, duplicates=0) == []


def test_risk_flags__duplicates() -> None:
    assert risk_flags(total=10, approved=10, rejected=0, duplicates=1) == ["duplicates"]


def test_risk_flags__no_receipts__low_data() -> None:
    assert risk_flags(total=0, approved=0, rejected=0, duplicates=0) == ["low_data"]


def test_build_stats__null_aggregates_from_outer_join__zeros() -> None:
    # A seller without receipts comes from an OUTER JOIN: every counter is NULL.
    row = SimpleNamespace(
        receipts_total=None,
        receipts_approved=None,
        receipts_rejected=None,
        receipts_on_review=None,
        receipts_30d=None,
        receipts_duplicates=None,
        first_receipt_at=None,
        last_receipt_at=None,
    )
    stats = build_stats(row, score=0)
    assert stats.receipts_total == 0
    assert stats.receipts_30d == 0
    assert stats.risk_level == "low"
    assert stats.risk_flags == ["low_data"]


def test_build_stats__maps_counters_and_score() -> None:
    ts = datetime(2026, 1, 1, tzinfo=UTC)
    row = SimpleNamespace(
        receipts_total=20,
        receipts_approved=10,
        receipts_rejected=10,
        receipts_on_review=0,
        receipts_30d=7,
        receipts_duplicates=4,
        first_receipt_at=ts,
        last_receipt_at=ts,
    )
    stats = build_stats(row, score=svc.RISK_HIGH)
    assert stats.receipts_30d == 7
    assert stats.risk_score == svc.RISK_HIGH
    assert stats.risk_level == "high"
    assert stats.risk_flags == ["high_reject_rate", "duplicates"]
    assert stats.last_receipt_at == ts
