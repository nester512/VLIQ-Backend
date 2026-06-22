"""Tests for the deprecated POST /receipts/qr-payload endpoint.

Standalone QR submission was removed per spec S3 (В-2-A): a scanned QR may only
accompany at least one photo/PDF. The endpoint now rejects every call with a
user-facing message; new submissions go through POST /receipts/upload (multipart
batch) or the presigned upload-urls + finalize flow with an optional ``scanned_qr``.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from src.app.auth.jwt import jwt_auth
from src.seller.models import Seller

PREFIX = "/api/v1/receipts"
_VALID_QR = "t=20260501T1430&s=599.00&fn=1234567890&i=12345&fp=67890&n=1"


def _seller_token(telegram_id: int = 12345) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


@pytest.mark.asyncio
async def test_qr_payload__deprecated__returns_400(client: AsyncClient, app: Any) -> None:
    """QR-only submission is removed → 400 QR_ONLY_DEPRECATED with a Russian message."""
    token = _seller_token(12345)
    response = await client.post(
        f"{PREFIX}/qr-payload",
        json={"qr_raw": _VALID_QR, "brand_id": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400, response.text
    body = response.json()
    assert body["code"] == "QR_ONLY_DEPRECATED"
    assert "user_message" in body
