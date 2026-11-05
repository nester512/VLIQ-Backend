"""PG integration: «↻ Новые» on the admin review deck (UC-A2, SSE hint stream).

- the worker announces a receipt only when it ENTERS the review queue: not a re-run of
  a receipt already there, not a blocked seller's receipt, not one still processing;
- the stream replays what reached the queue since the client's last server time
  (reconnect after Telegram went to the background), then forwards live events;
- the deck loads exactly the announced receipts with ``GET /receipts?ids=``.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text, update
from src.app.errors import AppError
from src.receipt.handlers.api.v1.router import ReceiptQueueSort, list_receipts
from src.receipt.models import Receipt
from src.receipt.review_events import CHANNEL, publish_if_entered_review, queue_status, stream

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio
ADMIN = {"user_id": 777, "role": "admin"}
OTHER = 990003  # an active seller next to the (blockable) seed seller


class FakeRedis:
    """publish() recorder + a pubsub fed from a list — enough for the stream."""

    def __init__(self, live: list[dict] | None = None) -> None:
        self.published: list[tuple[str, dict]] = []
        self.live = list(live or [])
        self.subscribed: list[str] = []
        self.closed = False

    async def publish(self, channel: str, data: str) -> None:
        self.published.append((channel, json.loads(data)))

    def pubsub(self) -> FakeRedis:
        return self

    async def subscribe(self, channel: str) -> None:
        self.subscribed.append(channel)

    async def unsubscribe(self, channel: str) -> None:
        self.subscribed.remove(channel)

    async def aclose(self) -> None:
        self.closed = True

    async def get_message(self, *, ignore_subscribe_messages: bool, timeout: float) -> dict | None:
        await asyncio.sleep(0)
        return {"type": "message", "data": json.dumps(self.live.pop(0))} if self.live else None


async def _seed(sm) -> dict[str, int]:
    async with sm() as s, s.begin():
        await s.execute(
            text(
                "INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at) "
                "VALUES (:t, :b, '+79990000003', 'active', now()) ON CONFLICT (telegram_id) DO UPDATE SET status='active'"
            ),
            {"t": OTHER, "b": SEED_BRAND_ID},
        )
        ids = {}
        for name, seller, status in (
            ("pending", OTHER, "pending"),
            ("queued", OTHER, "on_review"),
            ("blocked_pending", SEED_SELLER_ID, "pending"),
        ):
            r = Receipt(seller_id=seller, brand_id=SEED_BRAND_ID, status=status, bonus_amount=0)
            s.add(r)
            await s.flush()
            ids[name] = r.id
        await s.execute(text("UPDATE vliq.seller SET status='blocked' WHERE telegram_id = :t"), {"t": SEED_SELLER_ID})
    return ids


async def _set_status(sm, receipt_id: int, status: str) -> None:
    async with sm() as s, s.begin():
        await s.execute(update(Receipt).where(Receipt.id == receipt_id).values(status=status))


async def test_announced_only_when_entering_the_queue(session_factory) -> None:
    ids = await _seed(session_factory)
    redis = FakeRedis()

    before = await queue_status(session_factory, ids["pending"])
    await _set_status(session_factory, ids["pending"], "on_review")  # the job's effect
    assert await publish_if_entered_review(redis, session_factory, ids["pending"], before)

    # a re-run job on a receipt already in the queue — no second announcement
    before = await queue_status(session_factory, ids["queued"])
    assert not await publish_if_entered_review(redis, session_factory, ids["queued"], before)

    # a blocked seller's receipt is not work — not announced
    await _set_status(session_factory, ids["blocked_pending"], "on_review")
    assert not await publish_if_entered_review(redis, session_factory, ids["blocked_pending"], None)

    assert redis.published == [(CHANNEL, {"receipt_id": ids["pending"]})]


async def test_redis_failure_never_fails_the_job(session_factory) -> None:
    ids = await _seed(session_factory)
    await _set_status(session_factory, ids["pending"], "on_review")

    class Down(FakeRedis):
        async def publish(self, channel: str, data: str) -> None:
            raise ConnectionError("redis down")

    assert not await publish_if_entered_review(Down(), session_factory, ids["pending"], "pending")


async def _collect(redis, sm, since, frames: int) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []

    async def disconnected() -> bool:  # the admin «leaves» once enough frames arrived
        return len(out) >= frames

    async for chunk in stream(redis, sm, since=since, is_disconnected=disconnected, heartbeat_s=0):
        if chunk.startswith("event: "):
            head, data = chunk.strip().split("\n")
            out.append((head.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return out


async def test_stream_replays_since_then_forwards_live(session_factory) -> None:
    ids = await _seed(session_factory)
    async with session_factory() as s:
        db_now = await s.scalar(text("SELECT now()"))
    since = db_now - timedelta(seconds=1)
    async with session_factory() as s, s.begin():  # queued long ago — the client has it already
        await s.execute(
            update(Receipt).where(Receipt.id == ids["queued"]).values(updated_at=db_now - timedelta(hours=2))
        )
    await _set_status(session_factory, ids["pending"], "on_review")  # reached the queue while offline
    await _set_status(session_factory, ids["blocked_pending"], "on_review")  # blocked seller — skipped

    redis = FakeRedis(live=[{"receipt_id": 4242}, {"bogus": 1}])
    frames = await _collect(redis, session_factory, since, frames=4)

    names = [n for n, _ in frames]
    assert names == ["hello", "receipt", "receipt", "ping"]
    assert frames[1][1] == {"receipt_id": ids["pending"]}  # catch-up
    assert frames[2][1] == {"receipt_id": 4242}  # live; the malformed message is dropped
    assert datetime.fromisoformat(frames[3][1]["now"]).tzinfo is not None  # the client's next `since`
    assert redis.closed  # unsubscribed when the admin leaves
    assert redis.subscribed == []


async def test_first_connect_has_no_replay(session_factory) -> None:
    await _seed(session_factory)
    frames = await _collect(FakeRedis(), session_factory, None, frames=2)
    assert [n for n, _ in frames] == ["hello", "ping"]


async def _by_ids(sm, ids: str | None) -> list[int]:
    async with sm() as s:
        page = await list_receipts(
            ADMIN, s, page=1, limit=50, status_filter="on_review", seller_id=None, ids=ids, from_date=None,
            to_date=None, order="asc", queue=True, sort=ReceiptQueueSort.no_fiscal_first,
        )  # fmt: skip
        return sorted(int(i.id) for i in page.items)


async def test_deck_loads_exactly_the_announced_receipts(session_factory) -> None:
    ids = await _seed(session_factory)
    await _set_status(session_factory, ids["blocked_pending"], "on_review")
    wanted = f"{ids['queued']},{ids['pending']},{ids['blocked_pending']}"
    # still-pending and blocked seller's receipts are not returned — only queue work
    assert await _by_ids(session_factory, wanted) == [ids["queued"]]
    with pytest.raises(AppError):
        await _by_ids(session_factory, ",".join(str(i) for i in range(1, 52)))


async def test_nothing_new_since_last_seen_replays_nothing(session_factory) -> None:
    await _seed(session_factory)
    frames = await _collect(FakeRedis(), session_factory, datetime.now(UTC) + timedelta(days=1), frames=2)
    assert [n for n, _ in frames] == ["hello", "ping"]
