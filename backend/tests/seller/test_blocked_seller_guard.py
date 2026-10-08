"""S1 "двойной заслон": a blocked seller cannot act with a token issued before the block.

Covers ``forbid_blocked_seller`` and the routes it guards, plus the seller-side
ban on editing moderation fields (a seller must not lift their own block).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.seller.depends import forbid_blocked_seller
from src.seller.models import Seller, SellerStatus

SELLER_ID = 70000001


def _seller_token(telegram_id: int = SELLER_ID) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


def _session_with_status(status: str | None) -> MagicMock:
    session = MagicMock(spec=AsyncSession)
    session.scalar = AsyncMock(return_value=status)
    session.execute = AsyncMock(side_effect=AssertionError("handler must not run for a blocked seller"))
    return session


def _override(app, session: MagicMock) -> None:
    async def _dep():
        yield session

    app.dependency_overrides[get_pg_session] = _dep


# --- dependency unit tests ----------------------------------------------------


@pytest.mark.asyncio
async def test_forbid_blocked_seller__blocked__raises_seller_blocked():
    session = _session_with_status(SellerStatus.blocked.value)

    with pytest.raises(AppError) as exc:
        await forbid_blocked_seller({"user_id": SELLER_ID, "role": "seller"}, session)

    assert exc.value.code == "SELLER_BLOCKED"
    assert exc.value.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [SellerStatus.active.value, SellerStatus.pending.value])
async def test_forbid_blocked_seller__not_blocked__passes_token_through(status: str):
    token = {"user_id": SELLER_ID, "role": "seller"}

    assert await forbid_blocked_seller(token, _session_with_status(status)) is token


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["admin", "super_admin"])
async def test_forbid_blocked_seller__admin__no_status_lookup(role: str):
    session = _session_with_status(SellerStatus.blocked.value)
    token = {"user_id": 1, "role": role}

    assert await forbid_blocked_seller(token, session) is token
    session.scalar.assert_not_awaited()


# --- guarded routes (old token, seller blocked since) -------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        ("post", "/api/v1/receipts/upload", {"files": {"files": ("r.png", b"\x89PNG\r\n\x1a\n", "image/png")}, "data": {"brand_id": "1"}}),
        ("post", "/api/v1/receipts/upload-urls", {"json": {"brand_id": 1, "files": [{"mime": "image/png", "size": 10}]}}),
        ("post", "/api/v1/receipts/finalize", {"json": {}}),
        ("post", "/api/v1/payout-requests", {"json": {"amount": 100, "payout_kind": "sbp_phone"}, "headers": {"Idempotency-Key": "k"}}),
        ("patch", "/api/v1/sellers/me", {"json": {"outlet_name": "x"}}),
        ("patch", f"/api/v1/sellers/{SELLER_ID}", {"json": {"outlet_name": "x"}}),
    ],
)
async def test_blocked_seller__old_token__action_refused(client: AsyncClient, app, method, path, kwargs):
    _override(app, _session_with_status(SellerStatus.blocked.value))
    headers = {"Authorization": f"Bearer {_seller_token()}", **kwargs.pop("headers", {})}

    response = await getattr(client, method)(path, headers=headers, **kwargs)

    assert response.status_code == 403
    assert response.json()["code"] == "SELLER_BLOCKED"


# --- a seller cannot edit moderation fields ----------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{"status": "active"}, {"block_reason": "none"}, {"status": "blocked"}])
async def test_seller_patch_self__moderation_fields__forbidden(client: AsyncClient, app, body):
    session = _session_with_status(SellerStatus.blocked.value)
    session.scalar = AsyncMock(return_value=SellerStatus.active.value)  # pretend the guard passed
    _override(app, session)

    response = await client.patch(
        f"/api/v1/sellers/{SELLER_ID}",
        json=body,
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "AUTH_FORBIDDEN"
    session.execute.assert_not_awaited()
