"""Server-side MIME sniffing from magic bytes.

The client-supplied ``Content-Type`` is untrusted — a text file relabelled
``image/jpeg`` must be rejected, and a PDF must actually start with ``%PDF``. The
sniffed type (not the client's) becomes the stored ``mime_type``.

Only the four formats the product accepts are recognized; everything else returns
``None`` (→ the caller rejects it as an unsupported type).
"""

from __future__ import annotations


def sniff_mime(data: bytes) -> str | None:
    """Return the real MIME type of *data* from its signature, or ``None``.

    Recognizes JPEG, PNG, WebP and PDF.
    """
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:5] == b"%PDF-":
        return "application/pdf"
    return None
