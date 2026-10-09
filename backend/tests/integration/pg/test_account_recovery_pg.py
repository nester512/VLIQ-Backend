"""PG integration: recovering a seller who lost his Telegram account.

A super_admin links the NEW account after the identity check: the seller's data never
moves, the new account logs in as him, the lost one is switched off, messages go to the
new account, everything is audited; conflicts and payouts in progress are refused.
"""

from __future__ import annotations

import pytest
from jose import jwt
from sqlalchemy import func, select, text
from src.app.auth.jwt import jwt_auth
from src.app.errors import AppError
from src.audit_log.models import AuditLog
from src.auth.handlers.api.v1.router import _issue_token_for_telegram_id
from src.bonus_transaction.models import BonusTransaction
from src.payout_request.models import PayoutRequest
from src.receipt.models import Receipt
from src.seller.account_recovery import chat_id_for, transfer_login
from src.seller.models import Seller

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio
NEW = 990777
SUPER = 1
REASON = "Обращение в поддержку, личность подтверждена по видеозвонку и номеру телефона"


def _user_id(token: str) -> int:
    return jwt.decode(token, jwt_auth.secret, algorithms=[jwt_auth.algorithm])["user_id"]


async def _seed_money(sm) -> None:
    async with sm() as s, s.begin():
        s.add(Receipt(seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, status="approved", bonus_amount=5000))
        s.add(BonusTransaction(seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, amount=5000, kind="accrual_receipt",
                               source_type="receipt", source_id=1))  # fmt: skip


async def _transfer(sm, new: int = NEW, reason: str = REASON):
    async with sm() as s:
        return await transfer_login(s, seller_id=SEED_SELLER_ID, new_telegram_id=new, reason=reason, actor_id=SUPER)


async def _login(sm, telegram_id: int):
    async with sm() as s:
        return await _issue_token_for_telegram_id(telegram_id, s)


async def _counts(sm) -> tuple[int, int]:
    async with sm() as s:
        r = await s.scalar(select(func.count()).select_from(Receipt).where(Receipt.seller_id == SEED_SELLER_ID))
        b = await s.scalar(select(func.sum(BonusTransaction.amount)).where(BonusTransaction.seller_id == SEED_SELLER_ID))
        return int(r), int(b or 0)


async def test_new_account_logs_in_as_the_seller_old_one_is_switched_off(session_factory) -> None:
    sm = session_factory
    await _seed_money(sm)
    before = await _counts(sm)

    assert (await _transfer(sm))["already_linked"] is False

    login = await _login(sm, NEW)
    assert _user_id(login.access_token) == SEED_SELLER_ID  # same seller, same data
    assert await _counts(sm) == before  # nothing moved, nothing lost
    with pytest.raises(AppError) as err:
        await _login(sm, SEED_SELLER_ID)  # the lost account
    assert err.value.code == "ACCOUNT_MOVED"
    async with sm() as s:
        assert await chat_id_for(s, SEED_SELLER_ID) == NEW  # messages reach the new account
        (audit,) = (await s.execute(select(AuditLog).where(AuditLog.action == "transfer_seller_login"))).scalars()
    assert (audit.actor_id, audit.entity_id, audit.comment) == (SUPER, SEED_SELLER_ID, REASON)
    assert audit.payload["old_telegram_id"] == SEED_SELLER_ID
    assert audit.payload["new_telegram_id"] == NEW
    assert audit.created_at is not None


async def test_repeated_request_is_a_no_op(session_factory) -> None:
    await _transfer(session_factory)
    assert (await _transfer(session_factory))["already_linked"] is True
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "transfer_seller_login")) == 1


async def test_new_account_that_only_opened_the_app_is_replaced(session_factory) -> None:
    sm = session_factory
    await _login(sm, NEW)  # opening the app auto-creates an EMPTY pending seller
    await _transfer(sm)
    async with sm() as s:
        assert await s.get(Seller, NEW) is None
    assert _user_id((await _login(sm, NEW)).access_token) == SEED_SELLER_ID


async def test_registered_account_or_its_phone_is_a_conflict(session_factory) -> None:
    sm = session_factory
    async with sm() as s, s.begin():
        await s.execute(
            text("INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at) "
                 "VALUES (:t, :b, '+79991234500', 'active', now())"),
            {"t": NEW, "b": SEED_BRAND_ID},
        )  # fmt: skip
    with pytest.raises(AppError) as err:
        await _transfer(sm)
    assert err.value.code == "ACCOUNT_TRANSFER_CONFLICT"
    async with sm() as s:
        assert (await s.get(Seller, NEW)) is not None  # nobody's data is touched
        assert (await s.get(Seller, SEED_SELLER_ID)).primary_login_disabled is False


async def test_payout_in_progress_must_be_decided_first(session_factory) -> None:
    sm = session_factory
    async with sm() as s, s.begin():
        s.add(PayoutRequest(seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, amount=300_000, payout_kind="sbp_phone",
                            payout_masked="+79990000000", status="new"))  # fmt: skip
    with pytest.raises(AppError) as err:
        await _transfer(sm)
    assert err.value.code == "ACCOUNT_TRANSFER_PAYOUT_IN_PROGRESS"


@pytest.mark.parametrize(("new", "reason", "code"), [(SEED_SELLER_ID, REASON, "ACCOUNT_TRANSFER_SAME_ACCOUNT"),
                                                     (NEW, "ок", "ACCOUNT_TRANSFER_REASON_REQUIRED")])  # fmt: skip
async def test_input_is_validated(session_factory, new, reason, code) -> None:
    with pytest.raises(AppError) as err:
        await _transfer(session_factory, new=new, reason=reason)
    assert err.value.code == code
