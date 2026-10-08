"""Functional tests for GET /sellers (admin list): auth, query → SQL mapping, row mapping.

The aggregates themselves run against real PostgreSQL in
tests/integration/pg/test_seller_list_stats_pg.py; here we check the endpoint
wiring on a mock session (which statements it builds and how it maps rows).
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from src.admin.models import Admin, AdminRole
from src.app.auth.jwt import jwt_auth
from src.app.depends import get_pg_session
from src.seller.models import Seller

PREFIX = "/api/v1/sellers"


def _admin_token() -> str:
    admin = MagicMock(spec=Admin)
    admin.telegram_id = 999
    admin.role = AdminRole.admin
    admin.is_active = True
    return jwt_auth.create_token(admin)


def _seller_token() -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = 12345
    return jwt_auth.create_token(seller)


def _seller(telegram_id: int) -> SimpleNamespace:
    return SimpleNamespace(
        telegram_id=telegram_id,
        brand_id=1,
        phone_e164=f"+7999{telegram_id:07d}",
        first_name="Ivan",
        last_name="Petrov",
        city="Москва",
        region=None,
        outlet_name="Точка",
        outlet_address=None,
        outlet_count=1,
        outlet_chain=None,
        outlet_inn=None,
        position=None,
        status="active",
        block_reason=None,
        payout_kind=None,
        payout_masked=None,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=None,
        created_by=None,
        updated_by=None,
    )


def _row(telegram_id: int, **stats) -> SimpleNamespace:
    base = {
        "receipts_total": None,
        "receipts_approved": None,
        "receipts_rejected": None,
        "receipts_on_review": None,
        "receipts_30d": None,
        "receipts_duplicates": None,
        "first_receipt_at": None,
        "last_receipt_at": None,
        "risk_score": None,
    }
    base.update(stats)
    return SimpleNamespace(Seller=_seller(telegram_id), **base)


@pytest.fixture
def session_mock(app):
    session = MagicMock(spec=AsyncSession)
    count_result = MagicMock()
    count_result.scalar_one.return_value = 2
    rows_result = MagicMock()
    rows_result.all.return_value = [
        _row(1, receipts_total=30, receipts_approved=10, receipts_rejected=10, receipts_30d=5,
             receipts_on_review=2, receipts_duplicates=0, risk_score=25),
        _row(2),  # no receipts → OUTER JOIN NULLs
    ]
    session.execute = AsyncMock(side_effect=[count_result, rows_result])

    async def _override():
        yield session

    app.dependency_overrides[get_pg_session] = _override
    return session


def _sql(session: MagicMock, call: int) -> str:
    stmt = session.execute.await_args_list[call].args[0]
    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


@pytest.mark.asyncio
async def test_list_sellers__seller_token__403(client: AsyncClient) -> None:
    response = await client.get(PREFIX, headers={"Authorization": f"Bearer {_seller_token()}"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_list_sellers__maps_stats_and_total(client: AsyncClient, session_mock) -> None:
    response = await client.get(PREFIX, headers={"Authorization": f"Bearer {_admin_token()}"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    first, second = body["items"]
    assert first["stats"]["receipts_total"] == 30
    assert first["stats"]["receipts_30d"] == 5
    assert first["stats"]["risk_level"] == "medium"
    assert first["stats"]["risk_flags"] == ["high_reject_rate"]
    assert second["stats"]["receipts_total"] == 0
    assert second["stats"]["risk_flags"] == ["low_data"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sort", "expected"),
    [
        ("receipts_total:desc", "ORDER BY coalesce(seller_receipt_stats.receipts_total, 0) DESC NULLS LAST"),
        ("receipts_30d:desc", "ORDER BY coalesce(seller_receipt_stats.receipts_30d, 0) DESC NULLS LAST"),
        ("last_receipt_at:asc", "ORDER BY seller_receipt_stats.last_receipt_at ASC NULLS LAST"),
        ("bogus:desc", "ORDER BY vliq.seller.created_at DESC NULLS LAST"),
    ],
)
async def test_list_sellers__sort_maps_to_order_by(client: AsyncClient, session_mock, sort: str, expected: str) -> None:
    response = await client.get(PREFIX, params={"sort": sort}, headers={"Authorization": f"Bearer {_admin_token()}"})

    assert response.status_code == 200
    sql = _sql(session_mock, 1)
    assert expected in sql
    # telegram_id tiebreaker keeps offset pagination stable (no repeats/skips while scrolling).
    assert "vliq.seller.telegram_id DESC" in sql


@pytest.mark.asyncio
async def test_list_sellers__filters_applied_to_count_and_page(client: AsyncClient, session_mock) -> None:
    response = await client.get(
        PREFIX,
        params={"status": "blocked", "risk": "high", "has_on_review": "true", "search": "777"},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert response.status_code == 200
    for call in (0, 1):  # the total must be counted with the same filters as the page
        sql = _sql(session_mock, call)
        assert "vliq.seller.status = 'blocked'" in sql
        assert "coalesce(seller_receipt_stats.receipts_on_review, 0) > 0" in sql
        assert "vliq.seller.telegram_id = 777" in sql  # digits → exact telegram_id match too
        assert "ILIKE '%%777%%'" in sql or "ILIKE '%777%'" in sql


@pytest.mark.asyncio
async def test_list_sellers__invalid_risk__422(client: AsyncClient, session_mock) -> None:
    response = await client.get(PREFIX, params={"risk": "extreme"}, headers={"Authorization": f"Bearer {_admin_token()}"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_sellers__plain_total_skips_receipt_aggregate(client: AsyncClient, session_mock) -> None:
    response = await client.get(PREFIX, params={"status": "active"}, headers={"Authorization": f"Bearer {_admin_token()}"})

    assert response.status_code == 200
    count_sql = _sql(session_mock, 0)
    assert "seller_receipt_stats" not in count_sql  # no second full scan of receipts for the total
    assert "vliq.seller.status = 'active'" in count_sql


@pytest.mark.asyncio
@pytest.mark.parametrize("term", ["²", "99999999999999999999"])
async def test_list_sellers__non_ascii_or_huge_digits__no_500(client: AsyncClient, session_mock, term: str) -> None:
    response = await client.get(PREFIX, params={"search": term}, headers={"Authorization": f"Bearer {_admin_token()}"})

    assert response.status_code == 200
    assert "vliq.seller.telegram_id =" not in _sql(session_mock, 1)  # only the text match remains


@pytest.mark.asyncio
async def test_list_sellers__like_wildcards_escaped(client: AsyncClient, session_mock) -> None:
    response = await client.get(PREFIX, params={"search": "50%_off"}, headers={"Authorization": f"Bearer {_admin_token()}"})

    assert response.status_code == 200
    stmt = session_mock.execute.await_args_list[1].args[0]
    compiled = stmt.compile(dialect=postgresql.dialect())
    assert "%50\\%\\_off%" in compiled.params.values()  # wildcards escaped in the bound pattern
    assert "ESCAPE" in str(compiled)
