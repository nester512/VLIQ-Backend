"""Functional tests for POST /receipts/qr and the admin verification endpoints (mock session).

DB behaviour (idempotency, duplicates, retries) is covered on real PostgreSQL in
tests/integration/pg/test_qr_intake_pg.py.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from src.admin.models import Admin, AdminRole
from src.app.auth.jwt import jwt_auth
from src.receipt_intake.handlers.api.v1 import router as intake_router
from src.seller.depends import forbid_blocked_seller
from src.seller.models import Seller

URL = "/api/v1/receipts/qr"
BODY = {
    "brand_id": 1, "source": "telegram_scan", "fn": "9960440300712345", "fd": "12345", "fp": "3826178549",
    "t": "20261008T1432", "s": "1450.00", "n": 1, "idempotency_key": "k-1",
}


def _seller_token() -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = 12345
    return jwt_auth.create_token(seller)


def _admin_token() -> str:
    admin = MagicMock(spec=Admin)
    admin.telegram_id = 999
    admin.role = AdminRole.admin
    admin.is_active = True
    return jwt_auth.create_token(admin)


@pytest.fixture
def not_blocked(app):
    app.dependency_overrides[forbid_blocked_seller] = lambda: None
    yield
    app.dependency_overrides.pop(forbid_blocked_seller, None)


@pytest.fixture
def created(monkeypatch: pytest.MonkeyPatch):
    calls: dict = {}

    async def _create(session, **kw):
        calls.update(kw)
        return SimpleNamespace(id=77, status="pending"), True

    async def _warnings(session, receipt_id, data):
        return []

    monkeypatch.setattr(intake_router, "create_qr_receipt", _create)
    monkeypatch.setattr(intake_router, "_warnings", _warnings)
    return calls


@pytest.mark.asyncio
async def test_submit__valid__202_and_enqueues_qr_job(client: AsyncClient, app, not_blocked, created) -> None:
    pool = MagicMock()
    pool.enqueue_job = AsyncMock()
    app.state.arq_pool = pool
    try:
        response = await client.post(URL, json=BODY, headers={"Authorization": f"Bearer {_seller_token()}"})
    finally:
        app.state.arq_pool = None

    assert response.status_code == 202, response.text
    assert response.json() == {"receipt_id": 77, "status": "pending", "warnings": []}
    assert created["seller_id"] == 12345
    assert created["source"] == "telegram_scan"
    assert created["data"].canonical_qr == "t=20261008T1432&s=1450.00&fn=9960440300712345&i=12345&fp=3826178549&n=1"
    pool.enqueue_job.assert_awaited_once_with("process_qr_receipt_task", 77, _job_id="receipt-qr-77")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("patch", "code", "field"),
    [
        ({"fn": "123"}, "QR_FN_INVALID", "fn"),
        ({"t": "08.10.2026"}, "QR_DATE_INVALID", "t"),
        ({"s": "0"}, "QR_SUM_INVALID", "s"),
        ({"n": 3}, "QR_NOT_INCOME", "n"),
    ],
)
async def test_submit__invalid__422_with_field(  # noqa: PLR0913
    client: AsyncClient, not_blocked, created, patch, code, field
) -> None:
    response = await client.post(URL, json={**BODY, **patch}, headers={"Authorization": f"Bearer {_seller_token()}"})

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == code
    assert body["extra"] == {"field": field}
    assert body["user_message"]
    assert created == {}  # nothing was created


@pytest.mark.asyncio
async def test_submit__unknown_source__422(client: AsyncClient, not_blocked, created) -> None:
    response = await client.post(URL, json={**BODY, "source": "fax"}, headers={"Authorization": f"Bearer {_seller_token()}"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_submit__admin_token__403(client: AsyncClient, not_blocked) -> None:
    response = await client.post(URL, json=BODY, headers={"Authorization": f"Bearer {_admin_token()}"})
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/v1/receipts/5/journey"),
        ("POST", "/api/v1/receipts/5/verify"),
        ("GET", "/api/v1/check-providers"),
        ("PATCH", "/api/v1/check-providers/fns"),
    ],
)
async def test_journey_and_provider_endpoints__seller_token__403(client: AsyncClient, method: str, path: str) -> None:
    response = await client.request(method, path, json={}, headers={"Authorization": f"Bearer {_seller_token()}"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_provider_settings__plain_admin__403(client: AsyncClient) -> None:
    # Reordering / switching providers is a super_admin decision.
    response = await client.patch(
        "/api/v1/check-providers/fns", json={"enabled": False}, headers={"Authorization": f"Bearer {_admin_token()}"}
    )
    assert response.status_code == 403
