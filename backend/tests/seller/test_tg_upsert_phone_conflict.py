"""Tests for phone-conflict handling on POST /api/v1/sellers/tg-upsert.

When ``SellerRepository.ensure_seller`` detects a ``phone_e164`` unique-constraint
conflict it raises ``AppError("SELLER_PHONE_TAKEN", 409)``. The endpoint must
surface that as the unified envelope ``{code, user_message, debug_id}`` — not the
legacy ``{"detail": "phone_already_registered"}`` shape.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.app.errors import AppError

PREFIX = "/api/v1/sellers"


def _make_seller_token(user_id: int) -> str:
    """Issue a real JWT for the given seller telegram_id (mirrors auth tests)."""
    now = datetime.now(UTC)
    payload = {
        "uid": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=6)).timestamp()),
        "user_id": user_id,
        "role": "seller",
    }
    return jwt.encode(payload, jwt_auth.secret, algorithm=jwt_auth.algorithm)


def _tg_upsert_body(user_id: int) -> dict:
    return {
        "id": user_id,
        "brand_id": 1,
        "phone_e164": "+79991234567",
        "first_name": "Test",
        "last_name": "User",
    }


def _make_session() -> MagicMock:
    """Session whose ``begin()`` works as an async context manager."""
    session = MagicMock(spec=AsyncSession)

    begin_cm = MagicMock()
    begin_cm.__aenter__ = AsyncMock(return_value=session)
    begin_cm.__aexit__ = AsyncMock(return_value=False)
    session.begin = MagicMock(return_value=begin_cm)
    return session


@pytest.mark.asyncio
async def test_tg_upsert__phone_taken__returns_409_envelope(client: AsyncClient, app) -> None:
    """ensure_seller raises SELLER_PHONE_TAKEN → 409 with the full envelope."""
    # Arrange
    user_id = 999777
    token = _make_seller_token(user_id=user_id)
    session = _make_session()

    async def _override():
        yield session

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    # Act
    with patch(
        "src.seller.repository.SellerRepository.ensure_seller",
        new=AsyncMock(side_effect=AppError("SELLER_PHONE_TAKEN", status_code=409)),
    ):
        resp = await client.post(
            f"{PREFIX}/tg-upsert",
            json=_tg_upsert_body(user_id=user_id),
            headers={"Authorization": f"Bearer {token}"},
        )

    # Assert — unified envelope, not the legacy {"detail": ...}.
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "SELLER_PHONE_TAKEN"
    assert body["user_message"] == "Этот номер телефона уже зарегистрирован. Укажите другой."
    assert body["debug_id"]
    assert "detail" not in body
