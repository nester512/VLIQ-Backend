"""S1 "двойной заслон": a blocked seller cannot act with a token issued before the block.

Covers the seller part of ``check_account_access`` (run for every request by
``validate_token_dependency``) and the routes it guards, plus the seller-side ban on
editing moderation fields (a seller must not lift their own block).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import account_access_dependency, check_account_access, jwt_auth
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.seller.models import Seller, SellerStatus

SELLER_ID = 70000001


def _seller_token(telegram_id: int = SELLER_ID) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


def _session_with_status(status: str | None, *, moved: bool = False) -> MagicMock:
    """The guard reads the status (and, for the seller's own account, the recovery flag)."""
    session = MagicMock(spec=AsyncSession)
    session.scalar = AsyncMock(side_effect=[status, moved])
    session.execute = AsyncMock(side_effect=AssertionError("handler must not run for a blocked seller"))
    return session


def _override(app, session: MagicMock) -> None:
    async def _dep():
        yield session

    app.dependency_overrides[get_pg_session] = _dep
    app.dependency_overrides.pop(account_access_dependency, None)  # the real re-check


# --- dependency unit tests ----------------------------------------------------


@pytest.mark.asyncio
async def test_account_access__blocked_seller__raises_seller_blocked():
    session = _session_with_status(SellerStatus.blocked.value)

    with pytest.raises(AppError) as exc:
        await check_account_access({"user_id": SELLER_ID, "role": "seller"}, session)

    assert exc.value.code == "SELLER_BLOCKED"
    assert exc.value.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [SellerStatus.active.value, SellerStatus.pending.value])
async def test_account_access__seller_not_blocked__passes(status: str):
    token = {"user_id": SELLER_ID, "role": "seller"}

    assert await check_account_access(token, _session_with_status(status)) is None


@pytest.mark.asyncio
async def test_account_access__seller_row_gone__stale_token():
    with pytest.raises(AppError) as exc:
        await check_account_access({"user_id": SELLER_ID, "role": "seller"}, _session_with_status(None))
    assert (exc.value.code, exc.value.status_code) == ("AUTH_TOKEN_STALE", 401)


# --- guarded routes (old token, seller blocked since) -------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        (
            "post",
            "/api/v1/receipts/upload",
            {"files": {"files": ("r.png", b"\x89PNG\r\n\x1a\n", "image/png")}, "data": {"brand_id": "1"}},
        ),
        (
            "post",
            "/api/v1/receipts/upload-urls",
            {"json": {"brand_id": 1, "files": [{"mime": "image/png", "size": 10}]}},
        ),
        ("post", "/api/v1/receipts/finalize", {"json": {}}),
        (
            "post",
            "/api/v1/payout-requests",
            {"json": {"amount": 100, "payout_kind": "sbp_phone"}, "headers": {"Idempotency-Key": "k"}},
        ),
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
    session = _session_with_status(SellerStatus.active.value)  # the guard passes
    _override(app, session)

    response = await client.patch(
        f"/api/v1/sellers/{SELLER_ID}",
        json=body,
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "AUTH_FORBIDDEN"
    session.execute.assert_not_awaited()


# --- transaction hygiene (regression: upload 500 "A transaction is already begun") ---


@pytest.mark.asyncio
async def test_account_access__ends_the_transaction_it_started():
    session = _session_with_status(SellerStatus.active.value)
    session.in_transaction = MagicMock(return_value=False)

    await check_account_access({"user_id": SELLER_ID, "role": "seller"}, session)

    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_account_access__keeps_an_outer_transaction():
    session = _session_with_status(SellerStatus.active.value)
    session.in_transaction = MagicMock(return_value=True)

    await check_account_access({"user_id": SELLER_ID, "role": "seller"}, session)

    session.rollback.assert_not_awaited()


# --- account recovery: the lost account's old tokens stop working at once ------


@pytest.mark.asyncio
async def test_lost_account_token__after_recovery__account_moved():
    session = _session_with_status(SellerStatus.active.value, moved=True)
    with pytest.raises(AppError) as exc:
        # an old token: issued to the seller's own (now lost) Telegram account
        await check_account_access({"user_id": SELLER_ID, "role": "seller", "login_id": SELLER_ID}, session)
    assert (exc.value.code, exc.value.status_code) == ("ACCOUNT_MOVED", 403)


@pytest.mark.asyncio
async def test_lost_account_token_without_login_claim__account_moved():
    """Tokens issued before the claim existed count as the seller's own account."""
    session = _session_with_status(SellerStatus.active.value, moved=True)
    with pytest.raises(AppError):
        await check_account_access({"user_id": SELLER_ID, "role": "seller"}, session)


@pytest.mark.asyncio
async def test_recovered_account_token__passes():
    token = {"user_id": SELLER_ID, "role": "seller", "login_id": 990777}
    session = _session_with_status(SellerStatus.active.value, moved=True)
    assert await check_account_access(token, session) is None
    assert session.scalar.await_count == 1  # the recovered account never even reads the flag
