"""Notification outbox — enqueue, drain, and mark helpers.

All writes use the caller's session so they participate in the business
transaction.  The drain function uses SELECT … FOR UPDATE SKIP LOCKED so
multiple worker replicas can drain without stepping on each other.

Backoff schedule (attempt index 0-based, i.e. after the Nth failure):
  attempt 0 → 1 minute
  attempt 1 → 5 minutes
  attempt 2 → 30 minutes
  attempt 3 → 2 hours
  attempt 4 → 12 hours
  attempt ≥ 5 → status='dead'
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.prometheus_metrics import notification_outbox_dead, notification_outbox_pending
from src.notification.models import NotificationOutbox

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Backoff schedule
# ---------------------------------------------------------------------------

_BACKOFF: list[timedelta] = [
    timedelta(minutes=1),
    timedelta(minutes=5),
    timedelta(minutes=30),
    timedelta(hours=2),
    timedelta(hours=12),
]

MAX_ATTEMPTS = 5


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def enqueue(  # noqa: PLR0913
    session: AsyncSession,
    *,
    recipient_id: int,
    channel: str,
    template: str,
    payload: dict,
    scheduled_at: datetime | None = None,
) -> int:
    """Insert an outbox row into the caller's transaction.

    The row shares the same DB transaction as the business event — if that
    transaction rolls back, the outbox row disappears too (no phantom sends).

    Args:
        session: Active SQLAlchemy session; caller owns the transaction.
        recipient_id: Telegram user ID of the intended recipient.
        channel: ``'telegram'`` or ``'in_app'``.
        template: Logical notification template key (e.g. ``'receipt.approved'``).
        payload: Template variables dict serialised into JSONB.
        scheduled_at: Optional future send time; defaults to NOW().

    Returns:
        The newly-created row id.
    """
    row = NotificationOutbox(
        recipient_id=recipient_id,
        channel=channel,
        template=template,
        payload=payload,
        status="pending",
        attempts=0,
        scheduled_at=scheduled_at or datetime.now(tz=UTC),
    )
    session.add(row)
    await session.flush()  # populate row.id within the caller's transaction
    logger.debug(
        "outbox.enqueued id=%s channel=%s template=%s recipient=%s",
        row.id,
        channel,
        template,
        recipient_id,
    )
    return row.id


async def drain_due(
    session: AsyncSession,
    batch_size: int = 50,
) -> Sequence[NotificationOutbox]:
    """Fetch up to *batch_size* pending rows that are due for sending.

    Uses ``SELECT … FOR UPDATE SKIP LOCKED`` so concurrent workers never
    process the same row twice.

    Args:
        session: Active SQLAlchemy session (worker owns a begin() context).
        batch_size: Maximum number of rows to return.

    Returns:
        List of locked ``NotificationOutbox`` instances.
    """
    now = datetime.now(tz=UTC)
    stmt = (
        select(NotificationOutbox)
        .where(
            NotificationOutbox.status == "pending",
            NotificationOutbox.scheduled_at <= now,
        )
        .order_by(NotificationOutbox.scheduled_at)
        .limit(batch_size)
        .with_for_update(skip_locked=True)
    )
    result = await session.execute(stmt)
    rows = result.scalars().all()
    logger.debug("outbox.drain_due found=%d", len(rows))
    return rows


async def mark_sent(session: AsyncSession, row: NotificationOutbox) -> None:
    """Mark an outbox row as successfully delivered.

    Args:
        session: Active SQLAlchemy session.
        row: The outbox row that was sent.
    """
    now = datetime.now(tz=UTC)
    await session.execute(
        update(NotificationOutbox)
        .where(NotificationOutbox.id == row.id)
        .values(status="sent", sent_at=now)
    )
    logger.info("outbox.sent id=%s channel=%s template=%s", row.id, row.channel, row.template)


async def mark_failed(
    session: AsyncSession,
    row: NotificationOutbox,
    error: str,
) -> None:
    """Record a delivery failure and schedule a retry with exponential backoff.

    After ``MAX_ATTEMPTS`` failures the row is moved to ``status='dead'`` and
    will no longer be picked up by ``drain_due``.

    Args:
        session: Active SQLAlchemy session.
        row: The outbox row that failed.
        error: Human-readable error description stored in ``last_error``.
    """
    new_attempts = row.attempts + 1

    if new_attempts >= MAX_ATTEMPTS:
        await session.execute(
            update(NotificationOutbox)
            .where(NotificationOutbox.id == row.id)
            .values(
                status="dead",
                attempts=new_attempts,
                last_error=error,
            )
        )
        logger.warning(
            "outbox.dead id=%s channel=%s template=%s attempts=%d error=%s",
            row.id,
            row.channel,
            row.template,
            new_attempts,
            error,
        )
        return

    # Still within retry budget — schedule next attempt.
    backoff_index = min(row.attempts, len(_BACKOFF) - 1)
    backoff = _BACKOFF[backoff_index]
    next_scheduled = datetime.now(tz=UTC) + backoff

    await session.execute(
        update(NotificationOutbox)
        .where(NotificationOutbox.id == row.id)
        .values(
            attempts=new_attempts,
            last_error=error,
            scheduled_at=next_scheduled,
        )
    )
    logger.warning(
        "outbox.failed id=%s channel=%s template=%s attempts=%d backoff=%s error=%s",
        row.id,
        row.channel,
        row.template,
        new_attempts,
        backoff,
        error,
    )


async def refresh_outbox_gauges(session: AsyncSession) -> None:
    """Update Prometheus gauges for pending and dead outbox rows.

    Call this periodically (e.g. each worker drain cycle) so Prometheus can
    scrape current queue depths without a separate DB exporter.

    Args:
        session: Active SQLAlchemy session (read-only query; no transaction needed).
    """
    pending_result = await session.execute(
        select(func.count(NotificationOutbox.id)).where(NotificationOutbox.status == "pending")
    )
    dead_result = await session.execute(
        select(func.count(NotificationOutbox.id)).where(NotificationOutbox.status == "dead")
    )
    notification_outbox_pending.set(pending_result.scalar_one() or 0)
    notification_outbox_dead.set(dead_result.scalar_one() or 0)
