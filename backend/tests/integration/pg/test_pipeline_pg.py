"""Real-PostgreSQL integration tests for the receipt pipeline.

Guards the P0 defect that mock-session tests hid: late pipeline steps used
``session.begin()`` after earlier executes, raising "A transaction is already
begun". These run a REAL AsyncSession + real QR extraction (zxing) + real PDF
rasterization (pypdfium2), in demo mode for determinism (the full OFD path was
verified live).
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from src.fraud.checks import FraudChecker
from src.ofd_client.cache import InMemoryOFDCache
from src.ofd_client.fake import FakeOFDClient
from src.receipt.service import PreparedAttachment, create_receipt_package
from src.receipt_ocr.hasher import sha256_hash
from src.receipt_ocr.qr_extractor import QRExtractor
from src.receipt_ocr.storage import LocalFileStorage
from src.receipt_pipeline.orchestrator import ReceiptPipelineOrchestrator
from src.sku_matcher.matcher import SkuMatcher

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio

_QR_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "qr"
_OFD_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "ofd_responses"


def _qr_img(name: str, *, scale: int = 4) -> Image.Image:
    img = Image.open(_QR_DIR / name).convert("RGB")
    return img.resize((img.width * scale, img.height * scale), Image.NEAREST)


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _two_qr_one_image() -> bytes:
    a, b = _qr_img("qr_a.png", scale=3), _qr_img("qr_b.png", scale=3)
    canvas = Image.new("RGB", (a.width + b.width + 40, max(a.height, b.height) + 20), "white")
    canvas.paste(a, (10, 10))
    canvas.paste(b, (a.width + 30, 10))
    return _png(canvas)


def _two_page_pdf() -> bytes:
    a, b = _qr_img("qr_a.png"), _qr_img("qr_b.png")
    buf = io.BytesIO()
    a.save(buf, format="PDF", save_all=True, append_images=[b])
    return buf.getvalue()


def _blank() -> bytes:
    return _png(Image.new("RGB", (80, 80), "white"))


def _orchestrator(storage: LocalFileStorage, *, ocr_mode: str = "demo") -> ReceiptPipelineOrchestrator:
    return ReceiptPipelineOrchestrator(
        ofd_client=FakeOFDClient(fixtures_dir=_OFD_DIR),
        ofd_cache=InMemoryOFDCache(),
        qr_extractor=QRExtractor(),
        sku_matcher=SkuMatcher(),
        fraud_checker=FraudChecker(),
        ocr_mode=ocr_mode,
        storage=storage,
    )


async def _make_receipt(
    session_factory: async_sessionmaker[AsyncSession],
    storage: LocalFileStorage,
    files: list[tuple[bytes, str]],
    *,
    scanned_qr: str | None = None,
    key: str,
) -> int:
    """Save each (bytes, mime) to local storage and create a receipt package."""
    atts: list[PreparedAttachment] = []
    for i, (data, mime) in enumerate(files):
        uri = await storage.save(data, mime, SEED_SELLER_ID)
        atts.append(PreparedAttachment(i, uri, mime, sha256_hash(data), len(data)))
    async with session_factory() as s:
        receipt, _ = await create_receipt_package(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID,
            attachments=atts, scanned_qr=scanned_qr, idempotency_key=key,
        )
        return receipt.id


async def _row(session_factory, rid: int):
    async with session_factory() as s:
        return (
            await s.execute(
                text("SELECT status, rejection_code, rejection_reason FROM vliq.receipt WHERE id=:id"), {"id": rid}
            )
        ).one()


async def _count(session_factory, sql: str, **p) -> int:
    async with session_factory() as s:
        return (await s.execute(text(sql), p)).scalar_one()


_A_PNG = (_QR_DIR / "qr_a.png").read_bytes()  # fn=1234567890
_B_PNG = (_QR_DIR / "qr_b.png").read_bytes()  # fn=9876543210
_A_QR = "t=20260610T1430&s=599.00&fn=1234567890&i=12345&fp=67890&n=1"
_B_QR = "t=20260610T1015&s=350.00&fn=9876543210&i=54321&fp=22222&n=1"


# ---------------------------------------------------------------------------
# >1 identity → on_review with admin fraud signal (no auto-reject)
# ---------------------------------------------------------------------------


async def test_pipeline__A_plus_B_two_files__signals_for_review(session_factory, tmp_path) -> None:
    storage = LocalFileStorage(base_dir=tmp_path)
    rid = await _make_receipt(session_factory, storage, [(_A_PNG, "image/png"), (_B_PNG, "image/png")], key="ab-1234567")
    async with session_factory() as s:
        await _orchestrator(storage).process(rid, s)

    row = await _row(session_factory, rid)
    assert row.status == "on_review"
    assert row.rejection_code is None
    assert row.rejection_reason is None
    assert await _count(session_factory, "SELECT count(*) FROM vliq.receipt_attachment WHERE receipt_id=:id", id=rid) == 2
    # No seller notification: the admin has not rejected the receipt yet.
    assert await _count(
        session_factory, "SELECT count(*) FROM vliq.notification_outbox WHERE recipient_id=:s", s=SEED_SELLER_ID
    ) == 0


async def test_pipeline__retry_multiple_signal__no_notification(session_factory, tmp_path) -> None:
    storage = LocalFileStorage(base_dir=tmp_path)
    rid = await _make_receipt(session_factory, storage, [(_A_PNG, "image/png"), (_B_PNG, "image/png")], key="ab-retry-1")
    async with session_factory() as s:
        await _orchestrator(storage).process(rid, s)
    # Retry the now-reviewable receipt — still no seller rejection notification.
    async with session_factory() as s:
        await _orchestrator(storage).process(rid, s)
    assert (await _row(session_factory, rid)).status == "on_review"
    assert await _count(
        session_factory, "SELECT count(*) FROM vliq.notification_outbox WHERE recipient_id=:s", s=SEED_SELLER_ID
    ) == 0


async def test_pipeline__A_and_B_one_image__signals_for_review(session_factory, tmp_path) -> None:
    storage = LocalFileStorage(base_dir=tmp_path)
    rid = await _make_receipt(session_factory, storage, [(_two_qr_one_image(), "image/png")], key="abimg-12345")
    async with session_factory() as s:
        await _orchestrator(storage).process(rid, s)
    assert (await _row(session_factory, rid)).status == "on_review"


async def test_pipeline__A_and_B_pdf_pages__signals_for_review(session_factory, tmp_path) -> None:
    storage = LocalFileStorage(base_dir=tmp_path)
    rid = await _make_receipt(session_factory, storage, [(_two_page_pdf(), "application/pdf")], key="abpdf-12345")
    async with session_factory() as s:
        await _orchestrator(storage).process(rid, s)
    assert (await _row(session_factory, rid)).status == "on_review"


async def test_pipeline__scanned_A_plus_file_B__signals_for_review(session_factory, tmp_path) -> None:
    storage = LocalFileStorage(base_dir=tmp_path)
    rid = await _make_receipt(session_factory, storage, [(_B_PNG, "image/png")], scanned_qr=_A_QR, key="sab-123456")
    async with session_factory() as s:
        await _orchestrator(storage).process(rid, s)
    assert (await _row(session_factory, rid)).status == "on_review"


# ---------------------------------------------------------------------------
# 0 or 1 identity → on_review (never stuck pending)
# ---------------------------------------------------------------------------


async def test_pipeline__five_same_identity__on_review(session_factory, tmp_path) -> None:
    storage = LocalFileStorage(base_dir=tmp_path)
    rid = await _make_receipt(session_factory, storage, [(_A_PNG, "image/png")] * 5, key="aaaaa-12345")
    async with session_factory() as s:
        await _orchestrator(storage).process(rid, s)
    assert (await _row(session_factory, rid)).status == "on_review"


async def test_pipeline__single_A__on_review(session_factory, tmp_path) -> None:
    storage = LocalFileStorage(base_dir=tmp_path)
    rid = await _make_receipt(session_factory, storage, [(_A_PNG, "image/png")], key="singlea-1234")
    async with session_factory() as s:
        await _orchestrator(storage).process(rid, s)
    assert (await _row(session_factory, rid)).status == "on_review"


async def test_pipeline__scanned_A_plus_file_A__on_review(session_factory, tmp_path) -> None:
    storage = LocalFileStorage(base_dir=tmp_path)
    rid = await _make_receipt(session_factory, storage, [(_A_PNG, "image/png")], scanned_qr=_A_QR, key="saa-123456")
    async with session_factory() as s:
        await _orchestrator(storage).process(rid, s)
    assert (await _row(session_factory, rid)).status == "on_review"


async def test_pipeline__no_readable_qr__on_review(session_factory, tmp_path) -> None:
    storage = LocalFileStorage(base_dir=tmp_path)
    rid = await _make_receipt(session_factory, storage, [(_blank(), "image/png"), (_blank(), "image/png")], key="blank-12345")
    async with session_factory() as s:
        await _orchestrator(storage).process(rid, s)
    assert (await _row(session_factory, rid)).status == "on_review"


async def test_pipeline__never_stuck_pending(session_factory, tmp_path) -> None:
    storage = LocalFileStorage(base_dir=tmp_path)
    for files, key in (
        ([(_A_PNG, "image/png")], "np-1-123456"),
        ([(_A_PNG, "image/png"), (_B_PNG, "image/png")], "np-2-123456"),
        ([(_blank(), "image/png")], "np-3-123456"),
    ):
        rid = await _make_receipt(session_factory, storage, files, key=key)
        async with session_factory() as s:
            await _orchestrator(storage).process(rid, s)
        assert (await _row(session_factory, rid)).status != "pending"
