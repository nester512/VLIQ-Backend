"""«Не в работу» для заблокированных продавцов (S1 «двойной заслон», решения 2026-10-09).

A blocked seller's receipts leave the admin review queue and his payout requests in
progress leave the payout queue and its totals — nothing is deleted: the history stays
on the seller's page, and unblocking brings everything back (the filter is live, not
a status change).
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, select

from src.seller.models import Seller, SellerStatus


def blocked_seller_ids():  # noqa: ANN201 — a scalar subquery for IN / NOT IN
    return select(Seller.telegram_id).where(Seller.status == SellerStatus.blocked.value).scalar_subquery()


def not_blocked(seller_id_column) -> ColumnElement[bool]:  # noqa: ANN001
    return seller_id_column.not_in(blocked_seller_ids())


def is_blocked(seller_id_column) -> ColumnElement[bool]:  # noqa: ANN001
    return seller_id_column.in_(blocked_seller_ids())
