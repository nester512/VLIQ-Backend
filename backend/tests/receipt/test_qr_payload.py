"""Tests for POST /receipts/qr-payload duplicate handling.

Regression guard: re-scanning the same QR raised an HTTPException with a dict
`detail` (no `user_message`), so the TMA showed a generic "что-то пошло не так".
The fn/fd/fp duplicate now raises AppError → structured envelope with a Russian
message and the existing receipt id, matching POST /receipts/upload.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from src.app.auth.jwt import jwt_auth
from src.seller.models import Seller

PREFIX = "/api/v1/receipts"
# Valid Russian fiscal QR (mirrors tests/receipt_pipeline/test_thresholds.py).
_VALID_QR = "t=20260501T1430&s=599.00&fn=1234567890&i=12345&fp=67890&n=1"


def _seller_token(telegram_id: int = 12345) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


@pytest.mark.asyncio
async def test_qr_payload__same_qr_same_seller__returns_409_RECEIPT_DUPLICATE(
    client: AsyncClient, app: Any
) -> None:
    """Re-scanning the same QR → 409 with the RECEIPT_DUPLICATE envelope."""
    seller_id = 12345
    token = _seller_token(seller_id)

    import src.receipt.handlers.api.v1.router as router_mod  # noqa: PLC0415

    existing = MagicMock()
    existing.id = 555
    existing.seller_id = seller_id

    with patch.object(
        router_mod._fraud_checker, "check_fn_fd_fp", new=AsyncMock(return_value=existing)
    ):
        response = await client.post(
            f"{PREFIX}/qr-payload",
            json={"qr_raw": _VALID_QR, "brand_id": 1},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "RECEIPT_DUPLICATE"
    assert "user_message" in body
    assert body["extra"]["existing_receipt_id"] == 555
