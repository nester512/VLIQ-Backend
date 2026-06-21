"""PDF page rasterization via pypdfium2.

Used by the pipeline to turn each page of a PDF attachment into PNG bytes so the
QR extractor can look for fiscal QR codes on *every* page (a single PDF may carry
several different receipts — one per page). pypdfium2 ships a permissive,
self-contained manylinux wheel (no system poppler/libs required).
"""

from __future__ import annotations

import contextlib
import io
import logging

logger = logging.getLogger(__name__)

# Cap the number of rendered pages to bound work on adversarial/huge PDFs.
MAX_PDF_PAGES = 10
# Render scale (~144 DPI at scale 2.0) — enough for reliable QR decoding.
_RENDER_SCALE = 2.0


def render_pdf_pages(pdf_bytes: bytes, *, max_pages: int = MAX_PDF_PAGES) -> list[bytes]:
    """Rasterize the first *max_pages* pages of a PDF to PNG bytes.

    Returns one PNG (bytes) per successfully-rendered page, in page order. A page
    that fails to render is skipped (logged) rather than aborting the whole PDF.
    Returns an empty list if pypdfium2 is unavailable or the PDF cannot be opened.
    """
    try:
        import pypdfium2 as pdfium  # noqa: PLC0415
    except ImportError:
        logger.error("render_pdf_pages: pypdfium2 not installed")
        return []

    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:
        logger.warning("render_pdf_pages.open_failed: %s", exc)
        return []

    pages_png: list[bytes] = []
    try:
        n_pages = min(len(pdf), max_pages)
        for i in range(n_pages):
            try:
                page = pdf[i]
                bitmap = page.render(scale=_RENDER_SCALE)
                pil_image = bitmap.to_pil()
                buf = io.BytesIO()
                pil_image.save(buf, format="PNG")
                pages_png.append(buf.getvalue())
            except Exception as exc:
                logger.warning("render_pdf_pages.page_failed page=%d: %s", i, exc)
    finally:
        with contextlib.suppress(Exception):  # best-effort cleanup
            pdf.close()

    return pages_png
