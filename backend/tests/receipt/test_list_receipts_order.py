"""Admin review-queue ordering (GET /receipts): oldest-first FIFO with a stable
``id`` tiebreaker.

Mock sessions don't execute SQL, so we can't assert row order through the
endpoint. Instead we assert the ORDER BY the handler actually applies by
inspecting the compiled statement produced by the real ``_order_receipt_queue``
helper that ``list_receipts`` uses.
"""
from sqlalchemy import select
from src.receipt.handlers.api.v1.router import _order_receipt_queue
from src.receipt.models import Receipt


def _order_by_sql(stmt) -> str:
    return str(stmt).split("ORDER BY", 1)[1].strip()


def test_queue_is_ordered_oldest_first_with_id_tiebreaker() -> None:
    sql = _order_by_sql(_order_receipt_queue(select(Receipt)))
    # created_at ascending is the primary sort key (oldest first, FIFO)...
    assert "created_at ASC" in sql
    # ...and id ascending is the tiebreaker that makes offset/limit pagination
    # stable when many receipts share a created_at (bulk uploads).
    assert "id ASC" in sql
    # created_at must precede id in the ORDER BY.
    assert sql.index("created_at") < sql.index("id ASC")


def test_queue_order_is_not_descending() -> None:
    # Guard against a regression back to newest-first.
    sql = _order_by_sql(_order_receipt_queue(select(Receipt)))
    assert "DESC" not in sql


def test_helper_only_adds_ordering_and_keeps_filters() -> None:
    # The helper must add ordering without dropping the caller's WHERE clause.
    base = select(Receipt).where(Receipt.status == "on_review")
    ordered = str(_order_receipt_queue(base))
    assert "WHERE" in ordered
    assert "status" in ordered
    assert "ORDER BY" in ordered


def test_newest_first_for_seller_history_keeps_id_tiebreaker() -> None:
    # order=desc (admin seller page history): newest first, still a total order.
    sql = _order_by_sql(_order_receipt_queue(select(Receipt), newest_first=True))
    assert "created_at DESC" in sql
    assert "id DESC" in sql
    assert sql.index("created_at") < sql.index("id DESC")
