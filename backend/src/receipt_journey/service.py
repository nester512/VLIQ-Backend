"""Receipt journey — the single, append-only, reproducible log of a receipt.

docs/design/RECEIPT-JOURNEY.md. Call :func:`record` in the SAME transaction as
the change it describes: an event without the change (or a change without its
event) is impossible. ``seq`` is the order within the receipt; the receipt row
is locked first, so concurrent writers to one receipt never collide on it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.receipt.models import EventKind, Receipt, ReceiptEvent


async def record(  # noqa: PLR0913
    session: AsyncSession,
    receipt_id: int,
    kind: EventKind | str,
    *,
    actor_type: str,
    actor_id: int | None = None,
    source: str | None = None,
    outcome: str | None = None,
    check_id: int | None = None,
    data: dict[str, Any] | None = None,
    at: datetime | None = None,
) -> None:
    # Serialise writers of this receipt (no-op if the caller already holds the lock).
    await session.execute(select(Receipt.id).where(Receipt.id == receipt_id).with_for_update())
    next_seq = (
        select(func.coalesce(func.max(ReceiptEvent.seq), 0) + 1)
        .where(ReceiptEvent.receipt_id == receipt_id)
        .scalar_subquery()
    )
    values: dict[str, Any] = {
        "receipt_id": receipt_id,
        "seq": next_seq,
        "kind": str(kind),
        "actor_type": actor_type,
        "actor_id": actor_id,
        "source": source,
        "outcome": outcome,
        "check_id": check_id,
        "data": data or None,
    }
    if at is not None:
        values["at"] = at
    await session.execute(insert(ReceiptEvent).values(**values))


async def events_of(session: AsyncSession, receipt_id: int) -> list[ReceiptEvent]:
    rows = await session.execute(
        select(ReceiptEvent).where(ReceiptEvent.receipt_id == receipt_id).order_by(ReceiptEvent.seq)
    )
    return list(rows.scalars())
