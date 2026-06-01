"""Unit tests for sha256_hash utility."""

from __future__ import annotations

from src.receipt_ocr.hasher import sha256_hash


def test_sha256_hash__empty_bytes__known_digest():
    """SHA-256 of empty bytes is the well-known constant."""
    result = sha256_hash(b"")
    assert result == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def test_sha256_hash__abc_bytes__known_digest():
    """SHA-256 of b'abc' is a well-known constant."""
    result = sha256_hash(b"abc")
    assert result == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_sha256_hash__returns_lowercase_hex_string():
    """Output must be lowercase hex, 64 characters long."""
    result = sha256_hash(b"hello world")
    assert len(result) == 64
    assert result == result.lower()
    assert all(c in "0123456789abcdef" for c in result)


def test_sha256_hash__different_inputs__different_digests():
    """Two different byte strings must produce different digests."""
    assert sha256_hash(b"foo") != sha256_hash(b"bar")


def test_sha256_hash__same_input__deterministic():
    """Same input always produces same digest."""
    data = b"deterministic test data"
    assert sha256_hash(data) == sha256_hash(data)
