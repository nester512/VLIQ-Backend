"""GET /sellers/me/receipts returns a seller-facing whitelist, not the admin ReceiptRead."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.app.depends import get_pg_session
from src.receipt.schemas.api import SellerReceiptRead
from src.seller.models import Seller

SELLER_ID = 70000002
ADMIN_ONLY_FIELDS = {
    "admin_comments",
    "fraud_signals",
    "ocr_raw",
    "ocr_confidence",
    "qr_raw",
    "file_hash",
    "created_by",
    "updated_by",
    "is_deleted",
    "seller_name",
    "seller_store",
}


def _receipt_row(file_url: str | None = "s3://vliq-receipts/receipts/abc.png") -> MagicMock:
    row = MagicMock()
    row.id = 26
    row.seller_id = SELLER_ID
    row.brand_id = 1
    row.status = "on_review"
    row.bonus_amount = 0
    row.rejection_reason = None
    row.rejection_code = None
    row.file_kind = "photo"
    row.file_url = file_url
    row.file_hash = "deadbeef"
    row.purchase_date = None
    row.total_sum = None
    row.shop_name = None
    row.shop_inn = None
    row.qr_raw = None
    row.fn = row.fd = row.fp = None
    row.ocr_confidence = None
    row.ocr_raw = {"secret": "ocr"}
    row.items = None
    row.fraud_signals = [{"signal": "historical_duplicate_file_hash", "severity": "high", "duplicate_of_id": 25}]
    row.attachments = []
    row.admin_comments = [{"author_telegram_id": 1, "text": "internal note", "created_at": "2026-10-08T00:00:00Z"}]
    row.is_deleted = False
    row.created_at = datetime(2026, 10, 8, tzinfo=UTC)
    row.updated_at = None
    row.created_by = row.updated_by = SELLER_ID
    return row


def test_seller_receipt_read__whitelist_only():
    dto = SellerReceiptRead.model_validate(_receipt_row(), from_attributes=True)

    assert not ADMIN_ONLY_FIELDS & set(dto.model_dump())
    assert dto.items == []


def test_seller_receipt_read__file_url_is_signed_proxy_not_storage_key():
    dto = SellerReceiptRead.model_validate(_receipt_row(), from_attributes=True)

    assert dto.file_url is not None
    assert dto.file_url.startswith("/api/v1/receipts/attachments/file?sig=")
    assert "s3://" not in dto.file_url


def test_seller_receipt_read__non_viewable_file_url__none():
    dto = SellerReceiptRead.model_validate(_receipt_row(file_url="seed://r1.jpg"), from_attributes=True)

    assert dto.file_url is None


@pytest.mark.asyncio
async def test_get_me_receipts__no_admin_fields_in_response(client: AsyncClient, app):
    count_result = MagicMock()
    count_result.scalar_one.return_value = 1
    rows_result = MagicMock()
    rows_result.scalars.return_value.all.return_value = [_receipt_row()]
    session = MagicMock(spec=AsyncSession)
    session.execute = AsyncMock(side_effect=[count_result, rows_result])

    async def _dep():
        yield session

    app.dependency_overrides[get_pg_session] = _dep
    seller = MagicMock(spec=Seller)
    seller.telegram_id = SELLER_ID

    response = await client.get(
        "/api/v1/sellers/me/receipts",
        headers={"Authorization": f"Bearer {jwt_auth.create_token(seller)}"},
    )

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["id"] == 26
    assert not ADMIN_ONLY_FIELDS & set(item)
    assert "internal note" not in response.text
