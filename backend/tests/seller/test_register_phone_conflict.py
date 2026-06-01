"""Tests for PATCH /sellers/me phone-uniqueness handling.

A seller registering (or re-registering on another device) with a phone number
already used by another account previously surfaced as a raw HTTP 500
(unhandled asyncpg UniqueViolationError on ``seller_phone_e164_key``). It must
now return a clean 409 with the SELLER_PHONE_TAKEN envelope instead.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.seller.models import Seller

PREFIX = "/api/v1/sellers"


def _seller_token(telegram_id: int = 700000222) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


def _pending_seller(telegram_id: int = 700000222) -> Seller:
    s = MagicMock(spec=Seller)
    s.telegram_id = telegram_id
    s.brand_id = 1
    s.phone_e164 = f"+99{telegram_id}"  # synthetic stub from auto-create
    s.status = "pending"
    s.outlet_name = None
    s.payout_kind = None
    s.payout_masked = None
    return s


def _make_session(*, select_row: Seller, raise_on_update: Exception | None) -> MagicMock:
    session = MagicMock(spec=AsyncSession)

    select_result = MagicMock()
    select_result.scalar_one_or_none.return_value = select_row

    # 1st execute = SELECT (returns the row); 2nd execute = UPDATE (raises).
    side_effect: list = [select_result]
    if raise_on_update is not None:
        side_effect.append(raise_on_update)
    session.execute = AsyncMock(side_effect=side_effect)
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    return session


def _phone_conflict_error() -> IntegrityError:
    orig = Exception(
        'duplicate key value violates unique constraint "seller_phone_e164_key"\n'
        "DETAIL:  Key (phone_e164)=(+79991234567) already exists."
    )
    return IntegrityError("UPDATE vliq.seller ...", {}, orig)


_REG_PAYLOAD = {
    "phone_e164": "+79991234567",
    "first_name": "Test",
    "last_name": "Dup",
    "outlet_name": "Shop",
    "payout_kind": "sbp_phone",
    "payout_masked": "+79991234567",
}


@pytest.mark.asyncio
async def test_update_me__phone_taken__returns_409(client: AsyncClient, app) -> None:
    """Duplicate phone → 409 SELLER_PHONE_TAKEN (not a 500)."""
    session = _make_session(select_row=_pending_seller(), raise_on_update=_phone_conflict_error())

    async def _override():
        yield session

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.patch(
        f"{PREFIX}/me",
        json=_REG_PAYLOAD,
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )

    assert resp.status_code == 409
    assert resp.json()["code"] == "SELLER_PHONE_TAKEN"
    # The failed write must have been rolled back.
    session.rollback.assert_awaited_once()
