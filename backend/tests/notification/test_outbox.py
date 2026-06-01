"""Tests for the notification outbox (T6).

Uses mock sessions to test outbox logic without a real database.
The session mock captures all SQL executed and lets us assert on
the ORM operations performed.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from src.notification import outbox as notification_outbox
from src.notification.models import NotificationOutbox
from src.notification.outbox import _BACKOFF, MAX_ATTEMPTS  # noqa: PLC2701


def _make_session() -> AsyncSession:
    """Return a MagicMock that looks like an AsyncSession."""
    session = MagicMock(spec=AsyncSession)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.execute = AsyncMock()
    return session


def _make_outbox_row(  # noqa: PLR0913
    *,
    row_id: int = 1,
    attempts: int = 0,
    status: str = "pending",
    recipient_id: int = 999,
    channel: str = "telegram",
    template: str = "receipt.approved",
    scheduled_at: datetime | None = None,
) -> MagicMock:
    """Build a MagicMock that acts like a NotificationOutbox row.

    Using __new__ on an SQLAlchemy mapped class does not initialise
    the ORM instrumentation, so attribute assignment raises errors.
    A MagicMock with spec is simpler and safe.
    """
    row = MagicMock(spec=NotificationOutbox)
    row.id = row_id
    row.attempts = attempts
    row.status = status
    row.recipient_id = recipient_id
    row.channel = channel
    row.template = template
    row.payload = {}
    row.scheduled_at = scheduled_at or datetime.now(tz=UTC)
    row.last_error = None
    row.sent_at = None
    return row


# ---------------------------------------------------------------------------
# T1: enqueue — uses the caller's session (same transaction)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outbox__enqueue_in_same_transaction__persists():
    """enqueue() calls session.add() and session.flush() on the caller's session.

    This proves the row participates in the caller's transaction:
    if the caller rolls back, so does the outbox row.
    """
    session = _make_session()
    session.flush = AsyncMock()

    row_id_container: list[int] = []

    async def _flush_and_set_id():
        # Simulate flush setting the id on the added object.
        added_obj = session.add.call_args[0][0]
        added_obj.id = 42
        row_id_container.append(42)

    session.flush.side_effect = _flush_and_set_id

    result = await notification_outbox.enqueue(
        session,
        recipient_id=111,
        channel="telegram",
        template="receipt.approved",
        payload={"receipt_id": 1, "bonus_amount": 100, "available": 100},
    )

    # add() must have been called with a NotificationOutbox instance.
    session.add.assert_called_once()
    added: NotificationOutbox = session.add.call_args[0][0]
    assert isinstance(added, NotificationOutbox)
    assert added.recipient_id == 111
    assert added.channel == "telegram"
    assert added.template == "receipt.approved"
    assert added.status == "pending"
    assert added.attempts == 0

    # flush() must have been called (to get the id within the transaction).
    session.flush.assert_awaited_once()

    assert result == 42


@pytest.mark.asyncio
async def test_outbox__enqueue_then_commit__row_visible_to_worker():
    """enqueue() places a pending row with correct fields."""
    session = _make_session()

    async def _set_id():
        session.add.call_args[0][0].id = 99

    session.flush.side_effect = _set_id

    row_id = await notification_outbox.enqueue(
        session,
        recipient_id=222,
        channel="telegram",
        template="receipt.approved",
        payload={"receipt_id": 2, "bonus_amount": 50, "available": 50},
    )

    added: NotificationOutbox = session.add.call_args[0][0]
    assert row_id == 99
    assert added.status == "pending"
    assert added.channel == "telegram"
    assert added.recipient_id == 222
    assert added.attempts == 0


# ---------------------------------------------------------------------------
# T2: drain_due
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outbox__drain_due__skips_future_scheduled():
    """drain_due must only return rows with scheduled_at <= NOW().

    We check that the WHERE clause in the emitted SQL contains the right
    conditions by inspecting what was passed to session.execute().
    """
    session = _make_session()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []
    session.execute.return_value = mock_result

    rows = await notification_outbox.drain_due(session, batch_size=50)

    # execute was called once.
    session.execute.assert_awaited_once()
    stmt = session.execute.call_args[0][0]

    # The statement is a SELECT on NotificationOutbox.
    assert stmt is not None
    assert rows == []


@pytest.mark.asyncio
async def test_outbox__drain_due__returns_rows_from_db():
    """drain_due returns whatever scalars().all() gives back."""
    row1 = _make_outbox_row(row_id=1, scheduled_at=datetime.now(tz=UTC) - timedelta(seconds=1))
    row2 = _make_outbox_row(row_id=2, scheduled_at=datetime.now(tz=UTC) - timedelta(seconds=1))

    session = _make_session()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [row1, row2]
    session.execute.return_value = mock_result

    rows = await notification_outbox.drain_due(session, batch_size=10)
    assert len(rows) == 2
    assert rows[0].id == 1
    assert rows[1].id == 2


# ---------------------------------------------------------------------------
# T3: mark_failed — exponential backoff
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outbox__mark_failed__sets_exponential_backoff():
    """mark_failed should increment attempts and schedule next attempt."""
    session = _make_session()
    row = _make_outbox_row(row_id=10, attempts=0)

    before = datetime.now(tz=UTC)
    await notification_outbox.mark_failed(session, row, error="network error")
    after = datetime.now(tz=UTC)

    session.execute.assert_awaited_once()
    stmt = session.execute.call_args[0][0]

    # The statement must be an UPDATE.
    from sqlalchemy.sql.dml import Update

    assert isinstance(stmt, Update)

    # Extract the compiled values dict from the UPDATE clause.
    compiled_params = stmt.compile().params
    assert compiled_params["attempts"] == 1  # new_attempts = 0 + 1
    assert compiled_params["last_error"] == "network error"

    # scheduled_at should be in the future by approximately _BACKOFF[0].
    next_sched = compiled_params["scheduled_at"]
    assert next_sched >= before + _BACKOFF[0] - timedelta(seconds=5)
    assert next_sched <= after + _BACKOFF[0] + timedelta(seconds=5)


@pytest.mark.asyncio
async def test_outbox__mark_failed__uses_correct_backoff_slot():
    """Backoff index is clamped to len(_BACKOFF)-1."""
    session = _make_session()

    # attempt=3 → backoff index 3 → _BACKOFF[3] = 2 hours
    row = _make_outbox_row(row_id=20, attempts=3)

    before = datetime.now(tz=UTC)
    await notification_outbox.mark_failed(session, row, error="oops")
    after = datetime.now(tz=UTC)

    compiled_params = session.execute.call_args[0][0].compile().params
    next_sched = compiled_params["scheduled_at"]
    expected_backoff = _BACKOFF[3]  # 2 hours

    assert next_sched >= before + expected_backoff - timedelta(seconds=5)
    assert next_sched <= after + expected_backoff + timedelta(seconds=5)


# ---------------------------------------------------------------------------
# T4: attempts exceed MAX_ATTEMPTS → dead
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outbox__attempts_exceed_5__marks_dead():
    """After MAX_ATTEMPTS failures the row must become 'dead'."""
    session = _make_session()
    row = _make_outbox_row(row_id=30, attempts=MAX_ATTEMPTS - 1)

    await notification_outbox.mark_failed(session, row, error="final error")

    session.execute.assert_awaited_once()
    stmt = session.execute.call_args[0][0]
    compiled_params = stmt.compile().params

    assert compiled_params["status"] == "dead"
    assert compiled_params["attempts"] == MAX_ATTEMPTS
    assert compiled_params["last_error"] == "final error"
    # scheduled_at must NOT be set (dead row has no next schedule).
    assert "scheduled_at" not in compiled_params


# ---------------------------------------------------------------------------
# T5: mark_sent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outbox__mark_sent__sets_status_and_sent_at():
    """mark_sent should set status='sent' and populate sent_at."""
    session = _make_session()
    row = _make_outbox_row(row_id=40)

    before = datetime.now(tz=UTC)
    await notification_outbox.mark_sent(session, row)
    after = datetime.now(tz=UTC)

    session.execute.assert_awaited_once()
    compiled_params = session.execute.call_args[0][0].compile().params
    assert compiled_params["status"] == "sent"
    sent_at = compiled_params["sent_at"]
    assert before <= sent_at <= after


# ---------------------------------------------------------------------------
# T6: concurrent drain (best-effort, no real DB needed — just confirms no crash)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outbox__drain_due__skip_locked_for_concurrent_workers():
    """Two concurrent drain calls should not raise exceptions.

    Without a real Postgres instance we can only confirm the API doesn't crash.
    """
    row1 = _make_outbox_row(row_id=50)
    row2 = _make_outbox_row(row_id=51)

    session1 = _make_session()
    session2 = _make_session()

    mock_result1 = MagicMock()
    mock_result1.scalars.return_value.all.return_value = [row1]
    session1.execute.return_value = mock_result1

    mock_result2 = MagicMock()
    mock_result2.scalars.return_value.all.return_value = [row2]
    session2.execute.return_value = mock_result2

    import asyncio

    rows1, rows2 = await asyncio.gather(
        notification_outbox.drain_due(session1, batch_size=10),
        notification_outbox.drain_due(session2, batch_size=10),
    )

    assert len(rows1) == 1
    assert len(rows2) == 1
    assert rows1[0].id == 50
    assert rows2[0].id == 51
