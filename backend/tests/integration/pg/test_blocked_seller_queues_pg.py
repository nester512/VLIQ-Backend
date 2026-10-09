"""PG integration: a blocked seller leaves the admin work queues, not the history.

- review queue (queue=true) and its counters skip his receipts; approving a card
  opened before the block is refused; his history is still listed;
- payout queue and its totals skip his requests in progress (blocked=only shows them);
- unblocking brings everything back (the filter is live);
- the queue can put receipts without QR / fiscal data first (temporary rule, sort param).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from src.analytics.service import get_admin_dashboard
from src.app.errors import AppError
from src.payout_request.handlers.api.v1.router import list_payout_requests, payout_summary
from src.payout_request.models import PayoutRequest
from src.receipt.handlers.api.v1.router import ReceiptQueueSort, approve_receipt, list_receipts
from src.receipt.models import Receipt
from src.receipt.schemas.api import ReceiptReviewAction

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio
ADMIN = {"user_id": 777, "role": "admin"}
OTHER = 990002  # a second, active seller
_T0 = datetime.now(UTC) - timedelta(hours=5)


async def _seed(sm) -> dict[str, int]:
    async with sm() as s, s.begin():
        await s.execute(
            text(
                "INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at) "
                "VALUES (:t, :b, '+79990000002', 'active', now()) ON CONFLICT (telegram_id) DO UPDATE SET status='active'"
            ),
            {"t": OTHER, "b": SEED_BRAND_ID},
        )
        rows = {
            # name: (seller, minutes after T0, has fiscal data)
            "mine_qr": (SEED_SELLER_ID, 1, True),
            "other_qr_old": (OTHER, 0, True),
            "other_noqr_new": (OTHER, 3, False),
            "other_qr_new": (OTHER, 2, True),
        }
        ids = {}
        for name, (seller, minutes, fiscal) in rows.items():
            r = Receipt(
                seller_id=seller, brand_id=SEED_BRAND_ID, status="on_review", bonus_amount=1000,
                created_at=_T0 + timedelta(minutes=minutes),
                fn=f"99604403007{minutes:05d}" if fiscal else None, fd="1" if fiscal else None,
                fp=f"{minutes}1" if fiscal else None,
            )  # fmt: skip
            s.add(r)
            await s.flush()
            ids[name] = r.id
        for seller, status in ((SEED_SELLER_ID, "new"), (SEED_SELLER_ID, "paid"), (OTHER, "new")):
            s.add(PayoutRequest(seller_id=seller, brand_id=SEED_BRAND_ID, amount=300_000, payout_kind="sbp_phone",
                                payout_masked="+79990000000", status=status))  # fmt: skip
    return ids


async def _block(sm, status: str = "blocked") -> None:
    async with sm() as s, s.begin():
        await s.execute(text("UPDATE vliq.seller SET status = :st WHERE telegram_id = :t"), {"st": status, "t": SEED_SELLER_ID})


async def _queue(sm, **kw) -> list[int]:
    async with sm() as s:
        page = await list_receipts(
            ADMIN, s, page=1, limit=50, status_filter="on_review", seller_id=kw.get("seller_id"), from_date=None,
            to_date=None, order="asc", queue=kw.get("queue", True), sort=kw.get("sort", ReceiptQueueSort.created),
        )  # fmt: skip
        return [int(i.id) for i in page.items]


async def _payouts(sm, blocked: str = "exclude") -> list[tuple[int, str]]:
    async with sm() as s:
        page = await list_payout_requests(ADMIN, s, page=1, limit=50, seller_id=None, brand_id=None, req_status=None,
                                          date_from=None, date_to=None, search=None, blocked=blocked, order="asc")  # fmt: skip
        return [(p.seller_id, p.status.value) for p in page.items]


async def test_blocked_sellers_receipts_leave_the_review_queue_not_the_history(session_factory) -> None:
    sm = session_factory
    ids = await _seed(sm)
    await _block(sm)

    queue = await _queue(sm)
    assert ids["mine_qr"] not in queue
    assert len(queue) == 3
    assert ids["mine_qr"] in await _queue(sm, queue=False, seller_id=SEED_SELLER_ID)  # seller history keeps it
    async with sm() as s:
        assert (await get_admin_dashboard(s)).receipts_on_review == 3  # the counter matches the queue

    with pytest.raises(AppError) as err:  # a card opened before the block
        async with sm() as s:
            await approve_receipt(ids["mine_qr"], ReceiptReviewAction(bonus_amount=1000), ADMIN, s)
    assert err.value.code == "RECEIPT_SELLER_BLOCKED"

    await _block(sm, "active")  # unblock → back in the queue
    assert ids["mine_qr"] in await _queue(sm)


async def test_queue_puts_receipts_without_fiscal_data_first(session_factory) -> None:
    sm = session_factory
    ids = await _seed(sm)
    order = await _queue(sm, sort=ReceiptQueueSort.no_fiscal_first)
    assert order == [ids["other_noqr_new"], ids["other_qr_old"], ids["mine_qr"], ids["other_qr_new"]]
    assert await _queue(sm) == [ids["other_qr_old"], ids["mine_qr"], ids["other_qr_new"], ids["other_noqr_new"]]


async def test_blocked_sellers_payouts_in_progress_leave_the_payout_queue_and_totals(session_factory) -> None:
    sm = session_factory
    await _seed(sm)
    await _block(sm)

    main = await _payouts(sm)
    assert (SEED_SELLER_ID, "new") not in main  # not work: cannot be paid
    assert (SEED_SELLER_ID, "paid") in main  # history stays
    assert (OTHER, "new") in main
    assert sorted(await _payouts(sm, "only")) == [(SEED_SELLER_ID, "new"), (SEED_SELLER_ID, "paid")]
    async with sm() as s:
        summary = await payout_summary(ADMIN, s, seller_id=None, brand_id=None, date_from=None, date_to=None, search=None)
        dash = await get_admin_dashboard(s)
    assert (summary.new.count, summary.blocked_in_progress.count) == (1, 1)
    assert (dash.payouts_pending, dash.payouts_pending_amount) == (1, 300_000)

    await _block(sm, "active")
    assert (SEED_SELLER_ID, "new") in await _payouts(sm)
