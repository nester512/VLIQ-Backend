"""Tests for multi-candidate QR extraction (extract_all_qr_from_image).

Uses real QR fixtures (tests/fixtures/qr/qr_a.png, qr_b.png) so the zxing decode
path is genuinely exercised — the pipeline's multiple-receipts detection depends on
the extractor returning *all* codes, not just the first.
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image
from src.receipt_ocr.qr_extractor import extract_all_qr_from_image

_FIX = Path(__file__).parent.parent / "fixtures" / "qr"
_A_FN = "fn=1234567890"
_B_FN = "fn=9876543210"


def _img(name: str) -> Image.Image:
    return Image.open(_FIX / name).convert("RGB")


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_single_qr_image__one_candidate() -> None:
    texts = extract_all_qr_from_image((_FIX / "qr_a.png").read_bytes())
    assert len(texts) == 1
    assert _A_FN in texts[0]


def test_two_different_qr_in_one_image__two_candidates() -> None:
    """Two distinct fiscal QR codes side by side → both returned."""
    a, b = _img("qr_a.png"), _img("qr_b.png")
    w = a.width + b.width + 40
    h = max(a.height, b.height) + 20
    canvas = Image.new("RGB", (w, h), "white")
    canvas.paste(a, (10, 10))
    canvas.paste(b, (a.width + 30, 10))

    texts = extract_all_qr_from_image(_png_bytes(canvas))
    joined = " ".join(texts)
    assert _A_FN in joined
    assert _B_FN in joined
    assert len(set(texts)) == 2


def test_same_qr_twice_in_image__deduped() -> None:
    a = _img("qr_a.png")
    canvas = Image.new("RGB", (a.width * 2 + 30, a.height + 20), "white")
    canvas.paste(a, (10, 10))
    canvas.paste(a, (a.width + 20, 10))
    texts = extract_all_qr_from_image(_png_bytes(canvas))
    # Both decode to the same string → collapsed to one.
    assert texts == [t for t in texts if _A_FN in t]
    assert len(texts) == 1


def test_non_image_bytes__empty_list() -> None:
    assert extract_all_qr_from_image(b"not an image") == []


def test_image_without_qr__empty_list() -> None:
    blank = Image.new("RGB", (64, 64), "white")
    assert extract_all_qr_from_image(_png_bytes(blank)) == []
