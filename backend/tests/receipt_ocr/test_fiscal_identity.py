"""Unit tests for fiscal-identity normalization (the single source of truth)."""

from __future__ import annotations

from src.receipt_ocr.fiscal_identity import FiscalIdentity, normalize_fiscal_identity


def test_format_noise_collapses_to_same_identity() -> None:
    a = normalize_fiscal_identity("1234567890", "12345", "67890")
    b = normalize_fiscal_identity(" 1234567890 ", "12 345", "678-90")
    assert a is not None
    assert b is not None
    assert a == b
    # Hashable + equal → collapses to one entry in a set.
    assert len({a, b}) == 1


def test_incomplete_triple_is_not_confident() -> None:
    assert normalize_fiscal_identity("1234567890", "12345", None) is None
    assert normalize_fiscal_identity("1234567890", "", "67890") is None
    assert normalize_fiscal_identity(None, None, None) is None
    # Whitespace-only component is also incomplete.
    assert normalize_fiscal_identity("1234567890", "   ", "67890") is None


def test_distinct_identities_stay_distinct() -> None:
    a = normalize_fiscal_identity("1234567890", "12345", "67890")
    b = normalize_fiscal_identity("9876543210", "54321", "22222")
    assert a != b
    assert len({a, b}) == 2


def test_returns_frozen_identity() -> None:
    ident = normalize_fiscal_identity("fn", "fd", "fp")
    assert isinstance(ident, FiscalIdentity)
    assert ident.as_tuple() == ("FN", "FD", "FP")
