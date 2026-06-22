"""Tests for PDF page rasterization (render_pdf_pages) + QR extraction from pages.

Builds real PDFs from the QR fixtures via PIL (image → PDF), so the full
PDF → raster → QR path is exercised end to end.
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image
from src.receipt_ocr.pdf import render_pdf_pages
from src.receipt_ocr.qr_extractor import extract_all_qr_from_image

_FIX = Path(__file__).parent.parent / "fixtures" / "qr"


def _qr(name: str, *, upscale: int = 4) -> Image.Image:
    img = Image.open(_FIX / name).convert("RGB")
    # Upscale so the rasterized PDF page carries a crisply-decodable QR.
    return img.resize((img.width * upscale, img.height * upscale), Image.NEAREST)


def _to_pdf(*images: Image.Image) -> bytes:
    buf = io.BytesIO()
    first, *rest = images
    first.save(buf, format="PDF", save_all=True, append_images=list(rest))
    return buf.getvalue()


def test_single_page_pdf__renders_one_page_with_qr() -> None:
    pdf = _to_pdf(_qr("qr_a.png"))
    pages = render_pdf_pages(pdf)
    assert len(pages) == 1
    texts = extract_all_qr_from_image(pages[0])
    assert any("fn=1234567890" in t for t in texts)


def test_two_page_pdf__qr_a_and_b_on_separate_pages() -> None:
    pdf = _to_pdf(_qr("qr_a.png"), _qr("qr_b.png"))
    pages = render_pdf_pages(pdf)
    assert len(pages) == 2
    page0 = " ".join(extract_all_qr_from_image(pages[0]))
    page1 = " ".join(extract_all_qr_from_image(pages[1]))
    assert "fn=1234567890" in page0
    assert "fn=9876543210" in page1


def test_invalid_pdf_bytes__empty_list() -> None:
    assert render_pdf_pages(b"%PDF-1.4 totally broken") == []
    assert render_pdf_pages(b"not a pdf at all") == []


def test_max_pages_cap() -> None:
    pages_imgs = [_qr("qr_a.png")] * 4
    pdf = _to_pdf(*pages_imgs)
    rendered = render_pdf_pages(pdf, max_pages=2)
    assert len(rendered) == 2
