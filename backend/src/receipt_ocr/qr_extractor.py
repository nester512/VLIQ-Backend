"""QR code extraction from receipt images via zxing-cpp.

zxing-cpp provides a Python wheel with batteries included (no system libzbar needed).
It is listed in pyproject.toml as ``zxing-cpp``.

Standalone helper:
    ``extract_qr_from_image(data: bytes) -> str | None``

Class wrapper for async pipeline use:
    ``QRExtractor().extract(image_bytes)``
"""

from __future__ import annotations

import asyncio
import io
import logging
import re

logger = logging.getLogger(__name__)

# Russian fiscal QR pattern used to prefer matching barcodes.
_FISCAL_QR_RE = re.compile(r"t=\d{8}T\d{4}")


def extract_qr_from_image(data: bytes) -> str | None:
    """Decode QR codes from *data* (JPEG/PNG/WebP bytes).

    Tries zxing-cpp (bundled wheel, no system deps).
    If multiple QR codes are found, prefers the one matching the Russian fiscal
    QR pattern (``t=...&s=...&fn=...&i=...&fp=...``).

    Args:
        data: Raw image bytes.

    Returns:
        Raw QR string or ``None`` if no QR detected.
    """
    try:
        import zxingcpp  # noqa: PLC0415
        from PIL import Image  # noqa: PLC0415
    except ImportError:
        logger.error("extract_qr_from_image: zxing-cpp or Pillow not installed")
        return None

    try:
        image = Image.open(io.BytesIO(data))
    except Exception as exc:
        logger.warning("extract_qr_from_image.image_open_failed: %s", exc)
        return None

    try:
        results = zxingcpp.read_barcodes(image)
    except Exception as exc:
        logger.warning("extract_qr_from_image.decode_failed: %s", exc)
        return None

    if not results:
        return None

    qr_texts: list[str] = [r.text for r in results if r.format == zxingcpp.BarcodeFormat.QRCode]
    all_texts: list[str] = [r.text for r in results]
    candidates = qr_texts or all_texts

    # Prefer a candidate matching the Russian fiscal QR pattern.
    for text in candidates:
        if _FISCAL_QR_RE.search(text):
            logger.debug("extract_qr_from_image.fiscal_qr_found, length=%d", len(text))
            return text

    # Fall back to first QR / barcode found.
    logger.debug("extract_qr_from_image.non_fiscal_qr, length=%d", len(candidates[0]))
    return candidates[0]


def extract_all_qr_from_image(data: bytes) -> list[str]:
    """Decode **all** distinct QR/barcode texts from *data* (order-preserving).

    Unlike :func:`extract_qr_from_image`, which returns a single preferred
    candidate, this returns every distinct decoded string so the pipeline can
    detect *multiple different fiscal receipts* inside one image. Duplicate
    decodes of the same string are collapsed.

    Returns an empty list if decoding deps are missing or no barcode is found.
    """
    try:
        import zxingcpp  # noqa: PLC0415
        from PIL import Image  # noqa: PLC0415
    except ImportError:
        logger.error("extract_all_qr_from_image: zxing-cpp or Pillow not installed")
        return []

    try:
        image = Image.open(io.BytesIO(data))
    except Exception as exc:
        logger.warning("extract_all_qr_from_image.image_open_failed: %s", exc)
        return []

    try:
        results = zxingcpp.read_barcodes(image)
    except Exception as exc:
        logger.warning("extract_all_qr_from_image.decode_failed: %s", exc)
        return []

    texts: list[str] = []
    seen: set[str] = set()
    for r in results:
        text = r.text
        if text and text not in seen:
            seen.add(text)
            texts.append(text)
    return texts


class QRExtractor:
    """Extract QR code text from raw image bytes.

    Runs :func:`extract_qr_from_image` in a thread pool to keep the event loop free.
    Returns the raw QR string (Russian fiscal format) or ``None`` if no QR found.

    Russian fiscal QR format example:
        ``t=20260524T1430&s=12345.67&fn=...&i=...&fp=...&n=1``
    """

    async def extract(self, image_bytes: bytes) -> str | None:
        """Decode QR code from *image_bytes*.

        Args:
            image_bytes: JPEG / PNG / WebP bytes.

        Returns:
            Raw QR string or ``None`` if no QR is detected.
        """
        return await asyncio.to_thread(extract_qr_from_image, image_bytes)

    async def extract_all(self, image_bytes: bytes) -> list[str]:
        """Decode **all** distinct QR/barcode texts from *image_bytes* (off-loop).

        Returns every distinct decoded string (order-preserving) so the pipeline
        can detect multiple fiscal receipts in one image.
        """
        return await asyncio.to_thread(extract_all_qr_from_image, image_bytes)
