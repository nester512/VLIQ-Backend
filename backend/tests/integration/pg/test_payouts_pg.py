"""PG integration: payouts end to end (docs/design/PAYOUTS.md).

Real PostgreSQL, real transactions: money (ledger + balance), the request
lifecycle, receipt coverage FIFO (BRD В-8-A), «Выплачен» on receipts, journey
events, audit, outbox — and the receipt-side guards (reason / payout in progress).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from src.app.errors import AppError
from src.audit_log.models import AuditLog
from src.bonus_transaction.models import BonusTransaction
from src.notification.models import NotificationOutbox
from src.payout_request.handlers.api.v1.router import list_payout_requests, payout_receipts, payout_summary
from src.payout_request.models import PayoutReceipt, PayoutRequest
from src.payout_request.service import (
    approve_payout_request,
    create_payout_request,
    normalize_sbp_phone,
    reject_payout_request,
    take_payout_request,
    update_payout_request,
)
from src.receipt.handlers.api.v1.router import approve_receipt, delete_receipt, edit_receipt_bonus, reject_receipt
from src.receipt.models import Receipt, ReceiptEvent
from src.receipt.schemas.api import ReceiptDeleteRequest, ReceiptEditBonusRequest, ReceiptReviewAction
from src.receipt.service import create_qr_receipt
from src.receipt_intake.fiscal import validate_fields
from src.receipt_intake.pipeline import process_qr_receipt
from src.receipt_verification.providers import ProviderRegistry
from src.seller.services.balance_service import get_seller_balance

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio
ADMIN = {"user_id": 777, "role": "admin"}
MIN = 300_000
PHONE = "8 (999) 123-45-67"
_fp = iter(range(1000, 9999))


async def _approved(sm: async_sessionmaker[AsyncSession], bonus: int) -> int:
    """A QR receipt through intake → on_review → approved with ``bonus`` (kopecks)."""
    t = (datetime.now(UTC) + timedelta(hours=2)).strftime("%Y%m%dT%H%M")
    data = validate_fields(fn="9960440300712345", fd="12345", fp=f"38261{next(_fp)}", t=t, s="1450.00")
    async with sm() as s:
        receipt, _ = await create_qr_receipt(s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, data=data, source="manual")
        rid = receipt.id
    async with sm() as s:
        await process_qr_receipt(s, rid, ProviderRegistry({}))
    async with sm() as s:
        await approve_receipt(rid, ReceiptReviewAction(bonus_amount=bonus), ADMIN, s)
    return rid


async def _create(sm, amount: int, key: str = "key-00000001", phone: str = PHONE):
    async with sm() as s:
        return await create_payout_request(
            seller_id=SEED_SELLER_ID, amount=amount, payout_kind="sbp_phone", phone=phone,
            idempotency_key=key, min_amount=MIN, session=s,
        )


async def _balance(sm):
    async with sm() as s:
        return await get_seller_balance(seller_id=SEED_SELLER_ID, session=s)


async def _all(sm, model, *where):
    async with sm() as s:
        return list((await s.execute(select(model).where(*where))).scalars())


async def _kinds(sm, rid: int) -> list[str]:
    async with sm() as s:
        rows = await s.execute(select(ReceiptEvent.kind).where(ReceiptEvent.receipt_id == rid).order_by(ReceiptEvent.seq))
        return list(rows.scalars())


async def _status(sm, rid: int) -> str:
    async with sm() as s:
        return (await s.execute(select(Receipt.status).where(Receipt.id == rid))).scalar_one()


# ---- create ------------------------------------------------------------------


async def test_create_reserves_money_and_covers_oldest_receipts_first(session_factory) -> None:
    sm = session_factory
    r1, r2, r3 = await _approved(sm, 200_000), await _approved(sm, 200_000), await _approved(sm, 200_000)

    payout = await _create(sm, 300_000)

    assert payout.status == "new"
    assert payout.payout_masked == "+79991234567"  # normalised phone
    links = {link.receipt_id: link.amount for link in await _all(sm, PayoutReceipt, PayoutReceipt.payout_id == payout.id)}
    assert links == {r1: 200_000, r2: 100_000}  # FIFO, the second one partially; r3 untouched
    assert (await _kinds(sm, r1))[-1] == "included_in_payout"
    assert "included_in_payout" not in await _kinds(sm, r3)
    bal = await _balance(sm)
    assert (bal.available, bal.on_hold) == (300_000, 300_000)
    audit = await _all(sm, AuditLog, AuditLog.entity_type == "payout", AuditLog.entity_id == payout.id)
    assert [a.action for a in audit] == ["create_payout"]


async def test_same_idempotency_key_gives_one_request_and_one_hold(session_factory) -> None:
    await _approved(session_factory, 500_000)

    first = await _create(session_factory, 300_000, key="same-key-1")
    again = await _create(session_factory, 300_000, key="same-key-1")

    assert again.id == first.id
    assert len(await _all(session_factory, PayoutRequest)) == 1
    assert len(await _all(session_factory, BonusTransaction, BonusTransaction.kind == "payout_hold")) == 1


@pytest.mark.parametrize(
    ("amount", "phone", "code"),
    [
        (299_999, PHONE, "PAYOUT_BELOW_MINIMUM"),
        (300_000, "+7 495 123-45-67", "PAYOUT_PHONE_INVALID"),  # landline: SBP needs a mobile
        (300_000, "12345", "PAYOUT_PHONE_INVALID"),
        (600_000, PHONE, "PAYOUT_INSUFFICIENT_BALANCE"),
    ],
)
async def test_create_validation(session_factory, amount, phone, code) -> None:
    await _approved(session_factory, 500_000)
    with pytest.raises(AppError) as err:
        await _create(session_factory, amount, phone=phone)
    assert err.value.code == code
    assert await _all(session_factory, PayoutRequest) == []


async def test_pending_seller_cannot_request_payout(session_factory) -> None:
    await _approved(session_factory, 500_000)
    async with session_factory() as s, s.begin():
        await s.execute(text("UPDATE vliq.seller SET status = 'pending' WHERE telegram_id = :t"), {"t": SEED_SELLER_ID})
    with pytest.raises(AppError) as err:
        await _create(session_factory, 300_000)
    assert err.value.code == "SELLER_NOT_ACTIVE"


def test_phone_normalisation() -> None:
    assert normalize_sbp_phone("+7 (999) 111-22-33") == "+79991112233"
    assert normalize_sbp_phone("89991112233") == "+79991112233"
    assert normalize_sbp_phone("9991112233") == "+79991112233"


# ---- approve -----------------------------------------------------------------


async def test_paid__receipts_fully_covered_become_paid_out_and_one_notification(session_factory) -> None:
    sm = session_factory
    r1, r2 = await _approved(sm, 200_000), await _approved(sm, 200_000)
    payout = await _create(sm, 300_000)
    async with sm() as s:
        await take_payout_request(payout_id=payout.id, admin_id=777, session=s)

    async with sm() as s:
        paid = await approve_payout_request(payout_id=payout.id, admin_id=777, external_txn_id="SBP-1", session=s)
    async with sm() as s:  # a second click changes nothing and sends nothing
        await approve_payout_request(payout_id=payout.id, admin_id=777, session=s)

    assert paid.status == "paid"
    assert paid.paid_at is not None
    assert paid.taken_at is not None
    assert paid.external_txn_id == "SBP-1"
    assert await _status(sm, r1) == "paid_out"
    assert await _status(sm, r2) == "approved"  # only 100 000 of 200 000 paid
    assert (await _kinds(sm, r1))[-1] == "paid_out"
    async with sm() as s:
        partial = (
            await s.execute(select(ReceiptEvent.data).where(ReceiptEvent.receipt_id == r2, ReceiptEvent.kind == "paid_out"))
        ).scalar_one()
    assert partial == {"payout_id": payout.id, "amount": 100_000, "partial": True}

    sent = await _all(sm, NotificationOutbox, NotificationOutbox.template == "payout.sent")
    assert len(sent) == 1
    bal = await _balance(sm)
    assert (bal.available, bal.on_hold, bal.total_paid_out, bal.total_accrued) == (100_000, 0, 300_000, 400_000)
    actions = [a.action for a in await _all(sm, AuditLog, AuditLog.entity_type == "payout")]
    assert actions == ["create_payout", "take_payout", "approve_payout"]


async def test_next_payout_covers_the_rest_of_a_partly_paid_receipt(session_factory) -> None:
    sm = session_factory
    r1 = await _approved(sm, 500_000)
    first = await _create(sm, 300_000, key="k-first-1")
    async with sm() as s:
        await approve_payout_request(payout_id=first.id, admin_id=777, session=s)
    assert await _status(sm, r1) == "approved"

    # The rest of r1 (200 000) is below the 3 000 ₽ minimum: accrue more — the next
    # request covers what is left of r1 first, then the newer receipt.
    r2 = await _approved(sm, 300_000)
    second = await _create(sm, 300_000, key="k-second-2")
    links = {link.receipt_id: link.amount for link in await _all(sm, PayoutReceipt, PayoutReceipt.payout_id == second.id)}
    assert links == {r1: 200_000, r2: 100_000}
    async with sm() as s:
        await approve_payout_request(payout_id=second.id, admin_id=777, session=s)
    assert await _status(sm, r1) == "paid_out"


# ---- reject ------------------------------------------------------------------


async def test_reject_needs_reason_returns_money_and_releases_receipts(session_factory) -> None:
    sm = session_factory
    r1 = await _approved(sm, 400_000)
    payout = await _create(sm, 300_000)

    with pytest.raises(AppError) as err:
        async with sm() as s:
            await reject_payout_request(payout_id=payout.id, admin_id=777, admin_comment="  ", session=s)
    assert err.value.code == "PAYOUT_REJECT_REASON_REQUIRED"

    async with sm() as s:
        rejected = await reject_payout_request(payout_id=payout.id, admin_id=777, admin_comment="Неверный номер", session=s)

    assert (rejected.status, rejected.admin_comment) == ("rejected", "Неверный номер")
    assert rejected.rejected_at is not None
    bal = await _balance(sm)
    assert (bal.available, bal.on_hold) == (400_000, 0)
    assert (await _kinds(sm, r1))[-1] == "payout_reverted"
    (msg,) = await _all(sm, NotificationOutbox, NotificationOutbox.template == "payout.rejected")
    assert msg.payload == {"amount": 300_000, "reason": "Неверный номер"}
    # The receipt is free again: a new request covers it.
    again = await _create(sm, 300_000, key="key-again-1")
    assert {link.receipt_id for link in await _all(sm, PayoutReceipt, PayoutReceipt.payout_id == again.id)} == {r1}


async def test_paid_request_cannot_be_rejected(session_factory) -> None:
    await _approved(session_factory, 300_000)
    payout = await _create(session_factory, 300_000)
    async with session_factory() as s:
        await approve_payout_request(payout_id=payout.id, admin_id=777, session=s)
    with pytest.raises(AppError) as err:
        async with session_factory() as s:
            await reject_payout_request(payout_id=payout.id, admin_id=777, admin_comment="x", session=s)
    assert err.value.code == "PAYOUT_INVALID_STATE"


# ---- edit --------------------------------------------------------------------


async def test_amount_edit_moves_the_reserve_and_recomputes_coverage(session_factory) -> None:
    sm = session_factory
    r1, r2 = await _approved(sm, 300_000), await _approved(sm, 300_000)
    payout = await _create(sm, 300_000)
    async with sm() as s:
        await update_payout_request(payout_id=payout.id, admin_id=777, amount=450_000, session=s)

    links = {link.receipt_id: link.amount for link in await _all(sm, PayoutReceipt, PayoutReceipt.payout_id == payout.id)}
    assert links == {r1: 300_000, r2: 150_000}
    bal = await _balance(sm)
    assert (bal.available, bal.on_hold) == (150_000, 450_000)


# ---- receipt side: money already moved ---------------------------------------


async def test_receipt_under_payout_in_progress_cannot_be_cancelled(session_factory) -> None:
    sm = session_factory
    rid = await _approved(sm, 300_000)
    payout = await _create(sm, 300_000)

    for action in (
        lambda s: reject_receipt(rid, ReceiptReviewAction(comment="дубль"), ADMIN, s),
        lambda s: delete_receipt(rid, ReceiptDeleteRequest(reason="дубль"), ADMIN, s),
        lambda s: edit_receipt_bonus(rid, ReceiptEditBonusRequest(bonus_amount=1000, reason="ошибка"), ADMIN, s),
    ):
        with pytest.raises(AppError) as err:
            async with sm() as s:
                await action(s)
        assert err.value.code == "RECEIPT_IN_ACTIVE_PAYOUT"
        assert err.value.extra == {"payout_id": payout.id}
    assert await _status(sm, rid) == "approved"


async def test_cancelling_a_paid_out_receipt_books_a_debt_with_the_reason(session_factory) -> None:
    sm = session_factory
    rid = await _approved(sm, 300_000)
    payout = await _create(sm, 300_000)
    async with sm() as s:
        await approve_payout_request(payout_id=payout.id, admin_id=777, session=s)
    assert await _status(sm, rid) == "paid_out"

    with pytest.raises(AppError) as err:
        async with sm() as s:
            await reject_receipt(rid, ReceiptReviewAction(comment=None), ADMIN, s)
    assert err.value.code == "RECEIPT_CHANGE_REASON_REQUIRED"

    async with sm() as s:
        await reject_receipt(rid, ReceiptReviewAction(comment="чек оказался фиктивным"), ADMIN, s)

    (correction,) = await _all(sm, BonusTransaction, BonusTransaction.kind == "correction")
    assert correction.amount == -300_000
    assert correction.reason.endswith(": чек оказался фиктивным")
    bal = await _balance(sm)
    assert bal.available == -300_000  # the seller's debt
    with pytest.raises(AppError) as err:
        await _create(sm, 300_000, key="after-debt-1")
    assert err.value.code == "PAYOUT_INSUFFICIENT_BALANCE"


async def test_deleting_an_approved_receipt_gives_the_bonus_back_with_a_reason(session_factory) -> None:
    sm = session_factory
    rid = await _approved(sm, 50_000)
    with pytest.raises(AppError) as err:
        async with sm() as s:
            await delete_receipt(rid, None, ADMIN, s)
    assert err.value.code == "RECEIPT_CHANGE_REASON_REQUIRED"

    async with sm() as s:
        await delete_receipt(rid, ReceiptDeleteRequest(reason="загружен по ошибке"), ADMIN, s)

    assert (await _balance(sm)).available == 0
    async with sm() as s:
        data = (
            await s.execute(select(ReceiptEvent.data).where(ReceiptEvent.receipt_id == rid, ReceiptEvent.kind == "deleted"))
        ).scalar_one()
    assert data == {"reason": "загружен по ошибке", "bonus_reversed": 50_000}


async def test_lowering_a_bonus_needs_a_reason_raising_does_not(session_factory) -> None:
    sm = session_factory
    rid = await _approved(sm, 50_000)
    async with sm() as s:
        await edit_receipt_bonus(rid, ReceiptEditBonusRequest(bonus_amount=70_000), ADMIN, s)
    with pytest.raises(AppError) as err:
        async with sm() as s:
            await edit_receipt_bonus(rid, ReceiptEditBonusRequest(bonus_amount=10_000), ADMIN, s)
    assert err.value.code == "RECEIPT_CHANGE_REASON_REQUIRED"
    async with sm() as s:
        await edit_receipt_bonus(rid, ReceiptEditBonusRequest(bonus_amount=10_000, reason="ошиблись ставкой"), ADMIN, s)
    assert (await _balance(sm)).available == 10_000


# ---- admin read side ----------------------------------------------------------


async def test_summary_counts_every_request_not_one_page(session_factory) -> None:
    sm = session_factory
    await _approved(sm, 2_000_000)
    ids = [(await _create(sm, 300_000, key=f"many-key-{i}")).id for i in range(5)]
    async with sm() as s:
        await approve_payout_request(payout_id=ids[0], admin_id=777, session=s)
    async with sm() as s:
        await reject_payout_request(payout_id=ids[1], admin_id=777, admin_comment="нет", session=s)

    async with sm() as s:
        page = await list_payout_requests(ADMIN, s, page=1, limit=2, seller_id=None, brand_id=None, req_status=None,
                                          date_from=None, date_to=None, search=None)  # fmt: skip
        summary = await payout_summary(ADMIN, s, seller_id=None, brand_id=None, date_from=None, date_to=None, search=None)
        found = await list_payout_requests(ADMIN, s, page=1, limit=50, seller_id=None, brand_id=None, req_status=None,
                                           date_from=None, date_to=None, search=str(SEED_SELLER_ID))  # fmt: skip
        covered = await payout_receipts(ids[0], ADMIN, s)

    assert (page.total, len(page.items)) == (5, 2)
    assert (summary.new.count, summary.new.amount) == (3, 900_000)
    assert (summary.paid.count, summary.rejected.count, summary.in_progress.count) == (1, 1, 0)
    assert (summary.paid_this_month.count, summary.paid_this_month.amount) == (1, 300_000)
    assert found.total == 5
    assert [(c.amount, c.receipt_status) for c in covered] == [(300_000, "approved")]
