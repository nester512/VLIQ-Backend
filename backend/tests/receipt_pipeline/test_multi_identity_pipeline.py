"""Pipeline tests for multi-file fiscal-identity aggregation and system rejection.

Covers the frozen decision table (spec §6): 0 identities → on_review, 1 → normal
flow, >1 → MULTIPLE_RECEIPTS_DETECTED (terminal system rejection). Uses a fake QR
extractor + fake storage so the orchestrator's decision logic is tested without
real images, and a mock session so no DB is required.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from src.receipt.models import ReceiptAttachment, ReceiptStatus
from src.receipt_pipeline.orchestrator import ReceiptPipelineOrchestrator

# Two distinct fiscal QR strings (A != B).
_A = "t=20260610T1430&s=599.00&fn=1234567890&i=12345&fp=67890&n=1"
_B = "t=20260610T1015&s=350.00&fn=9876543210&i=54321&fp=22222&n=1"
_GARBAGE = "not-a-fiscal-qr"


class _FakeExtractor:
    """extract_all returns the configured QR list for the given image bytes."""

    def __init__(self, mapping: dict[bytes, list[str]]) -> None:
        self._m = mapping

    async def extract_all(self, data: bytes) -> list[str]:
        return list(self._m.get(data, []))

    async def extract(self, data: bytes) -> str | None:
        got = self._m.get(data, [])
        return got[0] if got else None


class _FakeStorage:
    def __init__(self, mapping: dict[str, bytes]) -> None:
        self._m = mapping

    async def read(self, uri: str) -> bytes:
        if uri in self._m:
            return self._m[uri]
        raise FileNotFoundError(uri)

    async def save(self, *a, **k):  # pragma: no cover - unused
        raise NotImplementedError


def _att(position: int, storage_uri: str, *, kind: str = "image", mime: str = "image/jpeg") -> MagicMock:
    a = MagicMock(spec=ReceiptAttachment)
    a.id = position + 1
    a.position = position
    a.kind = kind
    a.mime_type = mime
    a.storage_uri = storage_uri
    a.file_hash = f"hash{position}"
    return a


def _receipt(attachments: list, *, qr_raw: str | None = None, status: str = "pending") -> MagicMock:
    r = MagicMock()
    r.id = 1
    r.seller_id = 42
    r.brand_id = 1
    r.status = status
    r.qr_raw = qr_raw
    r.file_url = None
    r.bonus_amount = 0
    r.fraud_signals = []
    r.attachments = attachments
    return r


def _make_session() -> MagicMock:
    session = MagicMock(spec=AsyncSession)
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=None)
    session.execute = AsyncMock(return_value=result)
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.add = MagicMock()
    begin_cm = MagicMock()
    begin_cm.__aenter__ = AsyncMock(return_value=None)
    begin_cm.__aexit__ = AsyncMock(return_value=False)
    session.begin = MagicMock(return_value=begin_cm)
    return session


def _make_orchestrator(extractor_map, storage_map, *, ocr_mode="demo", ofd_client=None):
    from src.fraud.checks import FraudChecker  # noqa: PLC0415
    from src.ofd_client.cache import InMemoryOFDCache  # noqa: PLC0415
    from src.sku_matcher.matcher import SkuMatcher  # noqa: PLC0415

    return ReceiptPipelineOrchestrator(
        ofd_client=ofd_client or MagicMock(),
        ofd_cache=InMemoryOFDCache(),
        qr_extractor=_FakeExtractor(extractor_map),
        sku_matcher=SkuMatcher(),
        fraud_checker=FraudChecker(),
        ocr_mode=ocr_mode,
        storage=_FakeStorage(storage_map),
    )


async def _run(orch, receipt, session):
    with patch.object(orch, "_load_receipt", AsyncMock(return_value=receipt)):
        await orch.process(receipt.id, session)


# ---------------------------------------------------------------------------
# Decision table
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_five_same_identity__not_rejected() -> None:
    atts = [_att(i, f"uri{i}") for i in range(5)]
    storage = {f"uri{i}": f"bytes{i}".encode() for i in range(5)}
    extractor = {f"bytes{i}".encode(): [_A] for i in range(5)}  # all decode to A
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts)
    session = _make_session()
    await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.on_review.value


@pytest.mark.asyncio
async def test_a_none_a__not_rejected() -> None:
    atts = [_att(0, "u0"), _att(1, "u1"), _att(2, "u2")]
    storage = {"u0": b"0", "u1": b"1", "u2": b"2"}
    extractor = {b"0": [_A], b"1": [], b"2": [_A]}  # [A, None, A]
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts)
    session = _make_session()
    await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.on_review.value


@pytest.mark.asyncio
async def test_no_identities__on_review() -> None:
    atts = [_att(0, "u0"), _att(1, "u1")]
    storage = {"u0": b"0", "u1": b"1"}
    extractor = {b"0": [], b"1": []}  # [None, None]
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts)
    session = _make_session()
    await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.on_review.value


@pytest.mark.asyncio
async def test_a_and_b__multiple_receipts_rejected() -> None:
    atts = [_att(0, "u0"), _att(1, "u1")]
    storage = {"u0": b"0", "u1": b"1"}
    extractor = {b"0": [_A], b"1": [_B]}  # [A, B] → reject
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts)
    session = _make_session()
    with patch("src.receipt_pipeline.orchestrator.notification_outbox.enqueue", new=AsyncMock()) as enq:
        await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.rejected.value
    enq.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_and_b_in_one_image__rejected() -> None:
    atts = [_att(0, "u0")]
    storage = {"u0": b"0"}
    extractor = {b"0": [_A, _B]}  # both QR in one image
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts)
    session = _make_session()
    with patch("src.receipt_pipeline.orchestrator.notification_outbox.enqueue", new=AsyncMock()):
        await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.rejected.value


@pytest.mark.asyncio
async def test_a_and_b_on_pdf_pages__rejected() -> None:
    atts = [_att(0, "u0", kind="pdf", mime="application/pdf")]
    storage = {"u0": b"pdfdoc"}
    extractor = {b"pageA": [_A], b"pageB": [_B]}
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts)
    session = _make_session()
    with (
        patch("src.receipt_pipeline.orchestrator.render_pdf_pages", return_value=[b"pageA", b"pageB"]),
        patch("src.receipt_pipeline.orchestrator.notification_outbox.enqueue", new=AsyncMock()),
    ):
        await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.rejected.value


@pytest.mark.asyncio
async def test_scanned_a_plus_files_a__not_rejected() -> None:
    atts = [_att(0, "u0")]
    storage = {"u0": b"0"}
    extractor = {b"0": [_A]}
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts, qr_raw=_A)  # scanned A + file A → one receipt
    session = _make_session()
    await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.on_review.value


@pytest.mark.asyncio
async def test_scanned_a_plus_file_b__rejected() -> None:
    atts = [_att(0, "u0")]
    storage = {"u0": b"0"}
    extractor = {b"0": [_B]}
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts, qr_raw=_A)  # scanned A + file B → reject
    session = _make_session()
    with patch("src.receipt_pipeline.orchestrator.notification_outbox.enqueue", new=AsyncMock()):
        await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.rejected.value


@pytest.mark.asyncio
async def test_scanned_a_plus_unreadable_file__not_rejected() -> None:
    atts = [_att(0, "missing")]  # storage has no bytes → unreadable
    orch = _make_orchestrator({}, {})
    receipt = _receipt(atts, qr_raw=_A)
    session = _make_session()
    await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.on_review.value


@pytest.mark.asyncio
async def test_no_scanned_files_a__not_rejected() -> None:
    atts = [_att(0, "u0")]
    storage = {"u0": b"0"}
    extractor = {b"0": [_A]}
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts)
    session = _make_session()
    await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.on_review.value


# ---------------------------------------------------------------------------
# System rejection invariants
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_system_rejection__preserves_attachments_and_skips_ofd() -> None:
    atts = [_att(0, "u0"), _att(1, "u1")]
    storage = {"u0": b"0", "u1": b"1"}
    extractor = {b"0": [_A], b"1": [_B]}
    ofd = MagicMock()
    ofd.get_receipt = AsyncMock()
    orch = _make_orchestrator(extractor, storage, ocr_mode="full", ofd_client=ofd)
    receipt = _receipt(atts)
    session = _make_session()
    with patch("src.receipt_pipeline.orchestrator.notification_outbox.enqueue", new=AsyncMock()):
        await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.rejected.value
    assert receipt.attachments == atts  # nothing dropped
    ofd.get_receipt.assert_not_called()  # no OFD on system rejection


@pytest.mark.asyncio
async def test_system_rejection__one_notification_and_retry_is_noop() -> None:
    atts = [_att(0, "u0"), _att(1, "u1")]
    storage = {"u0": b"0", "u1": b"1"}
    extractor = {b"0": [_A], b"1": [_B]}
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts)
    session = _make_session()
    with patch("src.receipt_pipeline.orchestrator.notification_outbox.enqueue", new=AsyncMock()) as enq:
        await _run(orch, receipt, session)
        assert receipt.status == ReceiptStatus.rejected.value
        assert enq.await_count == 1
        # Retry the (now terminal) receipt — must be a no-op (no second notification).
        await _run(orch, receipt, session)
        assert enq.await_count == 1


@pytest.mark.asyncio
async def test_historical_duplicate__signal_not_rejection() -> None:
    atts = [_att(0, "u0")]
    storage = {"u0": b"0"}
    extractor = {b"0": [_A]}
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts)
    session = _make_session()
    existing = MagicMock()
    existing.id = 777
    with patch.object(orch._fraud_checker, "check_fn_fd_fp", new=AsyncMock(return_value=existing)):
        with patch.object(
            orch._fraud_checker, "historical_duplicate_signal", wraps=orch._fraud_checker.historical_duplicate_signal
        ) as sig:
            await _run(orch, receipt, session)
    # Historical dup → still on_review (saved), signal emitted, NOT rejected.
    assert receipt.status == ReceiptStatus.on_review.value
    sig.assert_called()


@pytest.mark.asyncio
async def test_parsing_failure__on_review_not_pending() -> None:
    atts = [_att(0, "u0")]
    storage = {"u0": b"0"}
    extractor = {b"0": [_GARBAGE]}  # decodes but doesn't parse to an identity
    orch = _make_orchestrator(extractor, storage)
    receipt = _receipt(atts)
    session = _make_session()
    await _run(orch, receipt, session)
    assert receipt.status == ReceiptStatus.on_review.value


@pytest.mark.asyncio
async def test_terminal_receipt__skipped() -> None:
    orch = _make_orchestrator({}, {})
    receipt = _receipt([_att(0, "u0")], status=ReceiptStatus.approved.value)
    session = _make_session()
    await _run(orch, receipt, session)
    # Untouched — approved is terminal.
    assert receipt.status == ReceiptStatus.approved.value
    session.begin.assert_not_called()
