"""GET /api/v1/receipts/review-events — the admin deck's «↻ Новые» stream (UC-A2).

Admins only; matched before ``/{receipt_id}``; served as an unbuffered event stream.
The stream content itself is covered on real PostgreSQL (test_review_events_pg.py).
"""

from __future__ import annotations

from unittest.mock import MagicMock

from src.admin.models import Admin, AdminRole
from src.app.auth.jwt import jwt_auth
from src.receipt.handlers.api.v1 import router as receipt_router
from src.seller.models import Seller

_PATH = "/api/v1/receipts/review-events"


def _token(role: str) -> str:
    if role == "seller":
        seller = MagicMock(spec=Seller)
        seller.telegram_id = 55555
        return jwt_auth.create_token(seller)
    admin = MagicMock(spec=Admin)
    admin.telegram_id = 999
    admin.role = AdminRole.admin
    admin.is_active = True
    return jwt_auth.create_token(admin)


def _auth(role: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(role)}"}


async def test_seller_and_anonymous_are_refused(client) -> None:
    assert (await client.get(_PATH)).status_code == 401
    assert (await client.get(_PATH, headers=_auth("seller"))).status_code == 403


async def test_admin_gets_an_unbuffered_event_stream(client, app, monkeypatch) -> None:
    app.state.arq_pool = object()
    seen: dict = {}

    async def fake_stream(redis, sm, *, since, is_disconnected):  # noqa: ANN001
        seen["since"] = since
        yield 'event: hello\ndata: {"now": "x"}\n\n'

    monkeypatch.setattr(receipt_router, "review_events_stream", fake_stream)
    resp = await client.get(_PATH, params={"since": "2026-11-05T10:00:00+00:00"}, headers=_auth("admin"))

    assert resp.status_code == 200  # not swallowed by /{receipt_id} (would be 422)
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert "no-transform" in resp.headers["cache-control"]
    assert resp.headers["x-accel-buffering"] == "no"
    assert "event: hello" in resp.text
    assert seen["since"].isoformat() == "2026-11-05T10:00:00+00:00"


async def test_no_redis_is_a_clear_503(client, app) -> None:
    app.state.arq_pool = None
    resp = await client.get(_PATH, headers=_auth("admin"))
    assert resp.status_code == 503
