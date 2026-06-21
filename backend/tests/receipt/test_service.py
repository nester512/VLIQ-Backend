"""Unit tests for the receipt package service (the single domain creator).

    test_create__one_attachment__creates_receipt_with_mirror
    test_create__five_attachments__ok
    test_create__mixed_image_and_pdf__kinds_derived
    test_create__scanned_qr_stored
    test_create__zero_attachments__raises
    test_create__six_attachments__raises
    test_create__duplicate_position__raises
    test_create__non_contiguous_positions__raises
    test_create__idempotency_hit__returns_existing_no_insert
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from src.receipt.models import AttachmentKind, ReceiptFileKind
from src.receipt.service import PackageValidationError, PreparedAttachment, create_receipt_package


def _att(position: int, mime: str = "image/jpeg") -> PreparedAttachment:
    return PreparedAttachment(
        position=position,
        storage_uri=f"s3://b/receipts/1/{position}.bin",
        mime=mime,
        file_hash=f"hash{position}",
        size_bytes=100 + position,
    )


def _make_session(existing: object | None = None) -> MagicMock:
    """Mock AsyncSession: idempotency lookup → *existing*; begin()/add() create path."""
    session = MagicMock(spec=AsyncSession)

    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=existing)
    session.execute = AsyncMock(return_value=result)

    begin_cm = MagicMock()
    begin_cm.__aenter__ = AsyncMock(return_value=None)
    begin_cm.__aexit__ = AsyncMock(return_value=False)
    session.begin = MagicMock(return_value=begin_cm)

    def _add(obj: object) -> None:
        if getattr(obj, "id", None) is None:
            obj.id = 99  # type: ignore[attr-defined]

    session.add = MagicMock(side_effect=_add)
    session.refresh = AsyncMock()
    session.rollback = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_create__one_attachment__creates_receipt_with_mirror() -> None:
    session = _make_session()
    receipt, created = await create_receipt_package(
        session,
        seller_id=1,
        brand_id=2,
        attachments=[_att(0, "image/jpeg")],
        idempotency_key="key-12345678",
    )
    assert created is True
    assert receipt.id == 99
    assert len(receipt.attachments) == 1
    # Legacy single-file mirror of the primary attachment.
    assert receipt.file_url == "s3://b/receipts/1/0.bin"
    assert receipt.file_hash == "hash0"
    assert receipt.file_kind == ReceiptFileKind.photo.value
    assert receipt.upload_idempotency_key == "key-12345678"
    assert receipt.qr_raw is None


@pytest.mark.asyncio
async def test_create__five_attachments__ok() -> None:
    session = _make_session()
    receipt, created = await create_receipt_package(
        session,
        seller_id=1,
        brand_id=2,
        attachments=[_att(i) for i in range(5)],
    )
    assert created is True
    assert len(receipt.attachments) == 5
    assert [a.position for a in receipt.attachments] == [0, 1, 2, 3, 4]


@pytest.mark.asyncio
async def test_create__mixed_image_and_pdf__kinds_derived() -> None:
    session = _make_session()
    receipt, _ = await create_receipt_package(
        session,
        seller_id=1,
        brand_id=2,
        attachments=[_att(0, "image/png"), _att(1, "application/pdf")],
    )
    kinds = {a.position: a.kind for a in receipt.attachments}
    assert kinds[0] == AttachmentKind.image.value
    assert kinds[1] == AttachmentKind.pdf.value
    # Primary (position 0) is an image → legacy file_kind=photo.
    assert receipt.file_kind == ReceiptFileKind.photo.value


@pytest.mark.asyncio
async def test_create__pdf_primary__legacy_kind_pdf() -> None:
    session = _make_session()
    receipt, _ = await create_receipt_package(
        session,
        seller_id=1,
        brand_id=2,
        attachments=[_att(0, "application/pdf")],
    )
    assert receipt.file_kind == ReceiptFileKind.pdf.value


@pytest.mark.asyncio
async def test_create__scanned_qr_stored() -> None:
    session = _make_session()
    qr = "t=20260610T1430&s=599.00&fn=1234567890&i=12345&fp=67890&n=1"
    receipt, _ = await create_receipt_package(
        session,
        seller_id=1,
        brand_id=2,
        attachments=[_att(0)],
        scanned_qr=qr,
    )
    assert receipt.qr_raw == qr


@pytest.mark.asyncio
async def test_create__zero_attachments__raises() -> None:
    session = _make_session()
    with pytest.raises(PackageValidationError):
        await create_receipt_package(session, seller_id=1, brand_id=2, attachments=[])


@pytest.mark.asyncio
async def test_create__six_attachments__raises() -> None:
    session = _make_session()
    with pytest.raises(PackageValidationError):
        await create_receipt_package(session, seller_id=1, brand_id=2, attachments=[_att(i) for i in range(6)])


@pytest.mark.asyncio
async def test_create__duplicate_position__raises() -> None:
    session = _make_session()
    with pytest.raises(PackageValidationError):
        await create_receipt_package(session, seller_id=1, brand_id=2, attachments=[_att(0), _att(0)])


@pytest.mark.asyncio
async def test_create__non_contiguous_positions__raises() -> None:
    session = _make_session()
    with pytest.raises(PackageValidationError):
        await create_receipt_package(session, seller_id=1, brand_id=2, attachments=[_att(0), _att(2)])


@pytest.mark.asyncio
async def test_create__idempotency_hit__returns_existing_no_insert() -> None:
    existing = MagicMock()
    existing.id = 42
    session = _make_session(existing=existing)
    receipt, created = await create_receipt_package(
        session,
        seller_id=1,
        brand_id=2,
        attachments=[_att(0)],
        idempotency_key="key-12345678",
    )
    assert created is False
    assert receipt is existing
    # No insert path on an idempotency hit.
    session.add.assert_not_called()
    session.begin.assert_not_called()
