"""Unit tests for the MinIO cleanup script's pure helpers (no DB / no S3)."""
import pytest
from src.scripts.cleanup_checked_receipts import build_placeholder, ext_format


def test_ext_format_maps_known_extensions() -> None:
    assert ext_format("s3://b/receipts/a.jpg") == ("JPEG", "image/jpeg")
    assert ext_format("s3://b/receipts/a.jpeg") == ("JPEG", "image/jpeg")
    assert ext_format("s3://b/receipts/a.png") == ("PNG", "image/png")
    assert ext_format("s3://b/receipts/a.pdf") == ("PDF", "application/pdf")


def test_ext_format_falls_back_to_jpeg_for_unknown() -> None:
    assert ext_format("s3://b/receipts/noext") == ("JPEG", "image/jpeg")
    assert ext_format("s3://b/receipts/a.bin") == ("JPEG", "image/jpeg")


@pytest.mark.parametrize(
    ("fmt", "magic"),
    [("JPEG", b"\xff\xd8"), ("PNG", b"\x89PNG"), ("PDF", b"%PDF")],
)
def test_build_placeholder_is_valid_and_small(fmt: str, magic: bytes) -> None:
    data = build_placeholder(fmt, deleted_on="2026-08-08", receipt_id=42)
    # Correct file signature so it renders in place of the original...
    assert data.startswith(magic)
    # ...and tiny compared to a multi-MB receipt (this is what reclaims space).
    assert 0 < len(data) < 200_000
