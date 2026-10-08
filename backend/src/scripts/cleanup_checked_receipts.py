"""Reclaim MinIO space for ALREADY-CHECKED receipts (approved / rejected).

Instead of deleting the object, each file is overwritten IN PLACE (same S3 key)
with a small native-format placeholder that carries the deletion date. This:
  * frees the space (a multi-MB image/PDF becomes a ~15 KB placeholder);
  * keeps the app's serving path working — no 404, no DB change, no migration;
  * marks the object done via S3 metadata ``purged=<date>`` (idempotent: a
    re-run skips already-purged objects).

Safety: only objects referenced EXCLUSIVELY by checked, non-deleted receipts are
touched. If ANY still-pending/active (non-deleted) receipt references the same
object — possible because files are content-addressed by hash — it is skipped.

Dry-run by default. Run inside the backend container (has S3_* env + MinIO net):

    docker compose exec backend python -m src.scripts.cleanup_checked_receipts            # dry-run
    docker compose exec backend python -m src.scripts.cleanup_checked_receipts --apply     # overwrite
    docker compose exec backend python -m src.scripts.cleanup_checked_receipts --apply --limit 1   # single, for a controlled test
"""
from __future__ import annotations

import argparse
import asyncio
import io
import logging
import os
from datetime import UTC, datetime

logger = logging.getLogger("cleanup_checked_receipts")

# How many candidate objects a dry-run lists before summarising the rest.
_DRY_RUN_PREVIEW = 15

# One object per row; ``needed`` is true if ANY non-deleted referencing receipt
# is NOT checked — such objects are kept. Result = objects owned solely by
# checked (approved/rejected) non-deleted receipts.
_SELECT_SQL = """
WITH att AS (
  SELECT a.storage_uri                                          AS uri,
         max(a.mime_type)                                       AS mime,
         min(a.receipt_id)                                      AS sample_receipt_id,
         max(a.size_bytes)                                      AS size_bytes,
         bool_or(r.status NOT IN ('approved', 'rejected'))      AS needed
  FROM vliq.receipt_attachment a
  JOIN vliq.receipt r ON r.id = a.receipt_id AND NOT r.is_deleted
  GROUP BY a.storage_uri
)
SELECT uri, mime, sample_receipt_id, size_bytes
FROM att
WHERE NOT needed
ORDER BY size_bytes DESC
"""

_FMT_BY_EXT = {
    "jpg": ("JPEG", "image/jpeg"),
    "jpeg": ("JPEG", "image/jpeg"),
    "png": ("PNG", "image/png"),
    "pdf": ("PDF", "application/pdf"),
}


def ext_format(uri: str) -> tuple[str, str]:
    """(Pillow format, Content-Type) inferred from the object key extension.

    The serving endpoint sets Content-Type from the URI extension, so the
    placeholder must be written in the SAME format the key implies. Unknown
    extensions fall back to JPEG.
    """
    ext = uri.rsplit(".", 1)[-1].lower() if "." in uri else ""
    return _FMT_BY_EXT.get(ext, ("JPEG", "image/jpeg"))


def build_placeholder(fmt: str, *, deleted_on: str, receipt_id: int) -> bytes:
    """A small, valid image/PDF that renders in place of the purged file.

    Text is ASCII on purpose: the Pillow default font has no Cyrillic glyphs, so
    the label stays Latin while the date (the point of the placeholder) is shown.
    """
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (1000, 640), (238, 240, 244))
    draw = ImageDraw.Draw(img)
    try:
        big = ImageFont.load_default(size=58)
        small = ImageFont.load_default(size=34)
    except TypeError:  # Pillow < 10.1 — non-scalable bitmap default
        big = small = ImageFont.load_default()
    draw.rectangle([40, 40, 960, 600], outline=(180, 186, 196), width=3)
    draw.text((80, 210), "RECEIPT FILE DELETED", fill=(90, 96, 108), font=big)
    draw.text((80, 300), f"deleted on {deleted_on}", fill=(120, 126, 138), font=small)
    draw.text((80, 350), f"receipt #{receipt_id}", fill=(120, 126, 138), font=small)
    draw.text((80, 440), "File removed to reclaim storage.", fill=(150, 156, 168), font=small)

    buf = io.BytesIO()
    save_kwargs = {"quality": 72} if fmt == "JPEG" else {}
    img.save(buf, format=fmt, **save_kwargs)
    return buf.getvalue()


async def _fetch_candidates(dsn: str) -> list[dict]:
    import asyncpg

    conn = await asyncpg.connect(dsn=dsn)
    try:
        rows = await conn.fetch(_SELECT_SQL)
    finally:
        await conn.close()
    return [dict(r) for r in rows]


async def run(*, apply: bool, limit: int | None) -> None:
    from src.receipt_ocr.storage import S3FileStorage, get_receipt_storage

    pg_url = os.environ.get("POSTGRES__POSTGRES_URL", "")
    if not pg_url:
        raise RuntimeError("POSTGRES__POSTGRES_URL is not set")
    dsn = pg_url.replace("postgresql+asyncpg://", "postgresql://")

    rows = await _fetch_candidates(dsn)
    if limit is not None:
        rows = rows[:limit]
    total = len(rows)
    reclaimable_mb = sum((r["size_bytes"] or 0) for r in rows) / 1e6
    logger.info("candidates=%d reclaimable=%.1f MB apply=%s", total, reclaimable_mb, apply)

    storage = get_receipt_storage()
    if not isinstance(storage, S3FileStorage):
        logger.error("RECEIPT_STORAGE is not 's3' — this job targets MinIO/S3 only. Aborting.")
        return

    if not apply:
        for r in rows[:_DRY_RUN_PREVIEW]:
            logger.info("[dry-run] would replace %s (%s, %d bytes)", r["uri"], r["mime"], r["size_bytes"])
        if total > _DRY_RUN_PREVIEW:
            logger.info("[dry-run] ... and %d more", total - _DRY_RUN_PREVIEW)
        logger.info("[dry-run] %d objects, ~%.1f MB. Re-run with --apply to overwrite.", total, reclaimable_mb)
        return

    deleted_on = datetime.now(UTC).strftime("%Y-%m-%d")
    bucket = storage._bucket  # noqa: SLF001 — ops script reuses the configured client
    prefix = f"s3://{bucket}/"
    done = skipped = errors = 0

    async with storage._make_client() as client:  # noqa: SLF001
        for r in rows:
            uri = r["uri"]
            if not uri.startswith(prefix):
                skipped += 1
                logger.warning("skip (not this bucket): %s", uri)
                continue
            key = uri[len(prefix):]
            try:
                # Idempotency: skip objects already carrying the purged marker.
                try:
                    head = await client.head_object(Bucket=bucket, Key=key)
                    if (head.get("Metadata") or {}).get("purged"):
                        skipped += 1
                        continue
                except Exception:  # noqa: BLE001 — missing/HEAD error → still try to write
                    pass
                fmt, ctype = ext_format(uri)
                body = build_placeholder(fmt, deleted_on=deleted_on, receipt_id=r["sample_receipt_id"])
                await client.put_object(
                    Bucket=bucket, Key=key, Body=body, ContentType=ctype,
                    Metadata={"purged": deleted_on},
                )
                done += 1
                if done % 100 == 0:
                    logger.info("... %d/%d overwritten", done, total)
            except Exception as exc:  # noqa: BLE001
                errors += 1
                logger.warning("failed on %s: %s", uri, exc)

    logger.info("DONE overwritten=%d skipped=%d errors=%d", done, skipped, errors)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Replace checked-receipt files in MinIO with a dated placeholder.")
    parser.add_argument("--apply", action="store_true", help="Actually overwrite (default: dry-run).")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N objects (for a controlled test).")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply, limit=args.limit))


if __name__ == "__main__":
    main()
