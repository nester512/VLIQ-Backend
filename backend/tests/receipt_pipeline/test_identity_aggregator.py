"""Unit tests for fiscal-identity candidate aggregation (0 / 1 / >1 decision)."""

from __future__ import annotations

from src.receipt_pipeline.identity_aggregator import aggregate_identities

_A = "t=20260610T1430&s=599.00&fn=1234567890&i=12345&fp=67890&n=1"
_A_NOISE = "t=20260610T1430&s=599.00&fn=1234567890&i=12345&fp=67890&n=1"  # same identity
_B = "t=20260610T1015&s=350.00&fn=9876543210&i=54321&fp=22222&n=1"
_GARBAGE = "totally not a qr"
_INCOMPLETE = "t=20260610T1430&s=599.00&fn=1234567890"  # missing i/fp → unparseable


def test_zero_identities__decision_none() -> None:
    agg = aggregate_identities([("a", _GARBAGE), ("b", _INCOMPLETE)])
    assert agg.decision == "none"
    assert agg.primary is None
    assert agg.unique_identities == []


def test_single_identity_repeated__decision_single() -> None:
    # [A, A, A, A, A] across five sources → one receipt.
    agg = aggregate_identities([(f"attachment[{i}]", _A) for i in range(5)])
    assert agg.decision == "single"
    assert agg.primary is not None
    assert agg.raw_for(agg.primary) == _A


def test_single_identity_with_gaps__decision_single() -> None:
    # [A, None, A] → still one receipt (None reads don't count).
    agg = aggregate_identities([("a0", _A), ("a1", _GARBAGE), ("a2", _A)])
    assert agg.decision == "single"


def test_two_identities__decision_multiple() -> None:
    agg = aggregate_identities([("a", _A), ("b", _B)])
    assert agg.decision == "multiple"
    assert agg.primary is None
    assert len(agg.unique_identities) == 2


def test_format_noise_does_not_split_identity() -> None:
    agg = aggregate_identities([("a", _A), ("a_noise", _A_NOISE)])
    assert agg.decision == "single"


def test_two_identities_in_one_source__decision_multiple() -> None:
    # Both A and B decoded from the same image (same source label).
    agg = aggregate_identities([("attachment[0]", _A), ("attachment[0]", _B)])
    assert agg.decision == "multiple"
