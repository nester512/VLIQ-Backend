"""UC-S7 «Банк получателя»: the bank list for the form and the server-side choice rules."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from src.app.auth.jwt import jwt_auth
from src.app.errors import AppError
from src.payout_request.models import PayoutRequest
from src.payout_request.sbp_banks import POPULAR_IDS, SBP_BANKS
from src.payout_request.service import destination_label, resolve_sbp_bank
from src.seller.models import Seller

SBER, TBANK = "100000000111", "100000000004"


def _seller_token() -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = 70000001
    return jwt_auth.create_token(seller)


def test_the_list_is_the_nspk_dictionary() -> None:
    assert len(SBP_BANKS) == 196
    assert all(len(i) == 12 and i.isdigit() for i in SBP_BANKS)  # NSPK member ids
    assert (SBP_BANKS[SBER], SBP_BANKS[TBANK]) == ("Сбербанк", "Т-Банк")
    assert set(POPULAR_IDS) <= set(SBP_BANKS)


@pytest.mark.asyncio
async def test_endpoint__popular_first_then_alphabetical(client: AsyncClient) -> None:
    response = await client.get(
        "/api/v1/payout-requests/sbp-banks", headers={"Authorization": f"Bearer {_seller_token()}"}
    )

    assert response.status_code == 200
    banks = response.json()
    assert len(banks) == len(SBP_BANKS)
    assert [b["id"] for b in banks[: len(POPULAR_IDS)]] == list(POPULAR_IDS)
    assert all(b["popular"] for b in banks[: len(POPULAR_IDS)])
    rest = [b["name"].casefold().replace("ё", "е") for b in banks[len(POPULAR_IDS) :]]
    assert rest == sorted(rest)
    assert not any(b["popular"] for b in banks[len(POPULAR_IDS) :])


@pytest.mark.asyncio
async def test_endpoint__needs_a_login(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/payout-requests/sbp-banks")).status_code == 401


def test_listed_bank__name_comes_from_the_list() -> None:
    assert resolve_sbp_bank(f" {TBANK} ", "Тинькофф") == (TBANK, "Т-Банк")


def test_other_bank__typed_name_tidied() -> None:
    assert resolve_sbp_bank("other", "  Хоум   Банк ") == ("other", "Хоум Банк")


@pytest.mark.parametrize(
    ("bank_id", "bank_name", "code", "field"),
    [
        (None, None, "PAYOUT_BANK_REQUIRED", "bank"),
        ("other", "", "PAYOUT_BANK_NAME_REQUIRED", "bank_name"),
        ("other", "x" * 101, "PAYOUT_BANK_NAME_REQUIRED", "bank_name"),
        ("12345", None, "PAYOUT_BANK_UNKNOWN", "bank"),
    ],
)
def test_bad_choice__error_points_at_the_field(bank_id, bank_name, code, field) -> None:
    with pytest.raises(AppError) as exc:
        resolve_sbp_bank(bank_id, bank_name)
    assert (exc.value.code, exc.value.status_code, exc.value.extra) == (code, 422, {"field": field})


def test_destination_label__with_and_without_a_bank() -> None:
    p = PayoutRequest(payout_masked="+79991234567", bank_name="Сбербанк")
    assert destination_label(p) == "+79991234567 · Сбербанк"
    p.bank_name = None  # a request made before the bank was asked
    assert destination_label(p) == "+79991234567"
