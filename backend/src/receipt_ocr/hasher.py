"""File hashing utilities for duplicate detection."""

from __future__ import annotations

import hashlib
import io


def sha256_hash(data: bytes) -> str:
    """Return lowercase hex SHA-256 digest of *data*.

    Used for file_hash deduplication in receipt upload flow.
    """
    return hashlib.sha256(data).hexdigest()


def phash(image_bytes: bytes) -> str:
    """Return perceptual hash of *image_bytes* as a hex string.

    Uses imagehash.phash + Pillow. The hash captures visual structure so that
    near-duplicate scans of the same receipt map to similar hashes even if
    rotation or brightness differ slightly.

    Returns:
        64-character hex string (256-bit phash).

    Raises:
        ValueError: Image cannot be decoded (corrupted or unsupported format).
    """
    try:
        import imagehash  # noqa: PLC0415
        from PIL import Image, UnidentifiedImageError  # noqa: PLC0415
    except ImportError as exc:
        raise ImportError(
            "imagehash and Pillow are required for phash. Install with: poetry add imagehash Pillow"
        ) from exc

    try:
        image = Image.open(io.BytesIO(image_bytes))
    except UnidentifiedImageError as exc:
        raise ValueError(f"Cannot decode image for phash: {exc}") from exc

    # imagehash.phash returns an ImageHash object; str() gives hex representation.
    return str(imagehash.phash(image))
