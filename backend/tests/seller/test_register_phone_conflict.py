"""Tests for PATCH /sellers/me phone-uniqueness handling.

A seller registering (or re-registering on another device) with a phone number
already used by another account previously surfaced as a raw HTTP 500
(unhandled asyncpg UniqueViolationError on ``seller_phone_e164_key``). It must
now return a clean 409 with the SELLER_PHONE_TAKEN envelope instead.
"""

from __future__ import annotations

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
    """IntegrityError detectable via the substring fallback in is_phone_conflict."""
    orig = Exception(
        'duplicate key value violates unique constraint "seller_phone_e164_key"\n'
        "DETAIL:  Key (phone_e164)=(+79991234567) already exists."
    )
    return IntegrityError("UPDATE vliq.seller ...", {}, orig)


def _phone_conflict_error_constraint_name() -> IntegrityError:
    """IntegrityError detectable via the precise ``constraint_name`` path.

    asyncpg's UniqueViolationError carries a ``constraint_name`` attribute; the
    text deliberately omits ``phone_e164`` so only the constraint-name branch of
    ``is_phone_conflict`` can classify it.
    """
    orig = Exception("duplicate key value violates unique constraint")
    orig.constraint_name = "seller_phone_e164_key"
    return IntegrityError("UPDATE vliq.seller ...", {}, orig)


def _other_integrity_error() -> IntegrityError:
    """IntegrityError unrelated to the phone constraint (e.g. a FK violation)."""
    orig = Exception(
        'insert or update on table "seller" violates foreign key constraint '
        '"seller_brand_id_fkey"'
    )
    orig.constraint_name = "seller_brand_id_fkey"
    return IntegrityError("UPDATE vliq.seller ...", {}, orig)


_REG_PAYLOAD = {
    "phone_e164": "+79991234567",
    "first_name": "Test",
    "last_name": "Dup",
    "outlet_name": "Shop",
    "payout_kind": "sbp_phone",
    "payout_masked": "+79991234567",
}


def _override_with(app, session: MagicMock) -> None:
    async def _override():
        yield session

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override


@pytest.mark.asyncio
async def test_update_me__phone_taken__returns_409(client: AsyncClient, app) -> None:
    """Duplicate phone (substring fallback) → 409 SELLER_PHONE_TAKEN envelope (not a 500)."""
    # Arrange
    session = _make_session(select_row=_pending_seller(), raise_on_update=_phone_conflict_error())
    _override_with(app, session)

    # Act
    resp = await client.patch(
        f"{PREFIX}/me",
        json=_REG_PAYLOAD,
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )

    # Assert — full envelope, not the legacy {"detail": ...} shape.
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "SELLER_PHONE_TAKEN"
    assert body["user_message"] == "Этот номер телефона уже зарегистрирован. Укажите другой."
    assert body["debug_id"]
    # The failed write must have been rolled back.
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_me__phone_taken_via_constraint_name__returns_409(client: AsyncClient, app) -> None:
    """Conflict detected via ``orig.constraint_name`` (precise path) → 409 SELLER_PHONE_TAKEN."""
    # Arrange
    session = _make_session(
        select_row=_pending_seller(),
        raise_on_update=_phone_conflict_error_constraint_name(),
    )
    _override_with(app, session)

    # Act
    resp = await client.patch(
        f"{PREFIX}/me",
        json=_REG_PAYLOAD,
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )

    # Assert
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "SELLER_PHONE_TAKEN"
    assert body["user_message"] == "Этот номер телефона уже зарегистрирован. Укажите другой."
    assert body["debug_id"]
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_me__other_integrity_error__returns_409_validation(client: AsyncClient, app) -> None:
    """A non-phone IntegrityError → 409 VALIDATION_ERROR (not misreported as phone conflict)."""
    # Arrange
    session = _make_session(select_row=_pending_seller(), raise_on_update=_other_integrity_error())
    _override_with(app, session)

    # Act
    resp = await client.patch(
        f"{PREFIX}/me",
        json=_REG_PAYLOAD,
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )

    # Assert
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["debug_id"]
    session.rollback.assert_awaited_once()
