"""POST /sellers/{id}/transfer-login is a super_admin action only (account recovery).

A seller can never link a new Telegram account himself (not even by phone), and an
ordinary admin cannot either — only a super_admin, after the identity check.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from jose import jwt
from src.app.auth.jwt import jwt_auth

URL = "/api/v1/sellers/12345/transfer-login"
BODY = {"new_telegram_id": 777, "reason": "Проверено по видеозвонку и номеру"}


def _token(role: str) -> str:
    now = datetime.now(UTC)
    payload = {"uid": uuid.uuid4().hex, "iat": int(now.timestamp()), "exp": int((now + timedelta(days=1)).timestamp()),
               "user_id": 12345, "role": role}  # fmt: skip
    return jwt.encode(payload, jwt_auth.secret, algorithm=jwt_auth.algorithm)


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["seller", "admin"])
async def test_only_super_admin_may_transfer(client: AsyncClient, role: str) -> None:
    resp = await client.post(URL, json=BODY, headers={"Authorization": f"Bearer {_token(role)}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_without_a_token__401(client: AsyncClient) -> None:
    assert (await client.post(URL, json=BODY)).status_code == 401


@pytest.mark.asyncio
async def test_reason_is_required(client: AsyncClient) -> None:
    resp = await client.post(URL, json={"new_telegram_id": 777, "reason": "ok"},
                             headers={"Authorization": f"Bearer {_token('super_admin')}"})  # fmt: skip
    assert resp.status_code == 422
    assert resp.json()["code"] == "ACCOUNT_TRANSFER_REASON_REQUIRED"  # a readable message, not a generic 422
