"""«Новые чеки на проверке» — live hint for the admin review deck (UC-A2, SSE).

The pipeline worker publishes a receipt id to Redis when the receipt ENTERS
``on_review``; the API streams those ids to every connected admin as Server-Sent
Events. The stream is only a hint: the deck still loads receipts through the regular
list endpoint, so a lost event costs nothing but a late button. On reconnect the
client passes ``since`` (the server time it last saw) and the stream first replays
the receipts that reached the queue in the meantime.

Payload is the receipt id only — no seller data travels through Redis or the stream.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.receipt.models import Receipt, ReceiptStatus
from src.seller.blocked import not_blocked

logger = logging.getLogger(__name__)

CHANNEL = "vliq:review-queue"
HEARTBEAT_S = 20.0  # < proxy idle timeouts; also carries the server clock for `since`
CATCH_UP_LIMIT = 50
RETRY_MS = 5000


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


async def queue_status(session_factory: async_sessionmaker[AsyncSession], receipt_id: int) -> str | None:
    """Status of the receipt as the review queue sees it: None if absent / deleted / blocked seller."""
    async with session_factory() as session:
        return await session.scalar(
            select(Receipt.status).where(
                Receipt.id == receipt_id, Receipt.is_deleted.is_(False), not_blocked(Receipt.seller_id)
            )
        )


async def publish_if_entered_review(
    redis,  # noqa: ANN001 — redis.asyncio.Redis / ArqRedis
    session_factory: async_sessionmaker[AsyncSession],
    receipt_id: int,
    before: str | None,
) -> bool:
    """Publish *receipt_id* when a job moved it into the review queue. Never raises:
    the event is a hint, a Redis hiccup must not fail the pipeline job."""
    try:
        after = await queue_status(session_factory, receipt_id)
        if after != ReceiptStatus.on_review.value or before == after:
            return False
        await redis.publish(CHANNEL, json.dumps({"receipt_id": receipt_id}))
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("review_events.publish_failed, receipt_id=%d: %s", receipt_id, exc)
        return False


async def _caught_up_ids(session: AsyncSession, since: datetime) -> list[int]:
    rows = await session.execute(
        select(Receipt.id)
        .where(
            Receipt.status == ReceiptStatus.on_review.value,
            Receipt.is_deleted.is_(False),
            Receipt.updated_at >= since,
            not_blocked(Receipt.seller_id),
        )
        .order_by(Receipt.updated_at)
        .limit(CATCH_UP_LIMIT)
    )
    return list(rows.scalars())


async def stream(
    redis,  # noqa: ANN001
    session_factory: async_sessionmaker[AsyncSession],
    *,
    since: datetime | None,
    is_disconnected: Callable[[], Awaitable[bool]],
    heartbeat_s: float = HEARTBEAT_S,
) -> AsyncIterator[str]:
    """SSE body: ``hello`` (+ catch-up ``receipt`` events), then live ``receipt`` events and ``ping``s."""
    pubsub = redis.pubsub()
    await pubsub.subscribe(CHANNEL)  # subscribe BEFORE the catch-up query: no gap between them
    try:
        yield f"retry: {RETRY_MS}\n\n"
        yield _event("hello", {"now": datetime.now(UTC).isoformat()})
        if since is not None:
            async with session_factory() as session:
                for receipt_id in await _caught_up_ids(session, since):
                    yield _event("receipt", {"receipt_id": receipt_id})
        while not await is_disconnected():
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=heartbeat_s)
            if msg is None:
                yield _event("ping", {"now": datetime.now(UTC).isoformat()})
                continue
            try:
                receipt_id = int(json.loads(msg["data"])["receipt_id"])
            except ValueError, KeyError, TypeError:
                continue
            yield _event("receipt", {"receipt_id": receipt_id})
    finally:
        try:
            await pubsub.unsubscribe(CHANNEL)
            await pubsub.aclose()
        except Exception:  # noqa: BLE001, S110 — the connection is going away anyway
            pass
