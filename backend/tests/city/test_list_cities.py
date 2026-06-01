"""Tests for GET /api/v1/cities — the city reference dictionary.

The dropdown on the seller registration form is rendered from this endpoint and
the backend validates ``seller.city`` against the same dictionary. The contract:
- requires a valid token (any role) via ``validate_token_dependency``;
- returns active cities only by default, sorted by ``sort_order`` then ``name``;
- each element matches the ``CityRead`` shape.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.seller.models import Seller

PREFIX = "/api/v1/cities"

_CREATED_AT = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


def _seller_token(telegram_id: int = 700000333) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


def _city(
    *,
    id: int,
    name: str,
    region: str | None,
    sort_order: int,
    is_active: bool = True,
) -> SimpleNamespace:
    """A lightweight City stand-in carrying the attributes CityRead reads."""
    return SimpleNamespace(
        id=id,
        name=name,
        region=region,
        is_active=is_active,
        sort_order=sort_order,
        created_at=_CREATED_AT,
        updated_at=None,
    )


def _make_session(rows: list) -> MagicMock:
    """Mock session whose ``execute(stmt).scalars().all()`` yields ``rows``.

    The handler does ``(await session.execute(stmt)).scalars().all()`` — so
    ``execute`` must be awaitable (AsyncMock) and its result must expose a
    synchronous ``.scalars().all()`` chain.
    """
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows

    session = MagicMock(spec=AsyncSession)
    session.execute = AsyncMock(return_value=result)
    return session


def _expected(city: SimpleNamespace) -> dict:
    return {
        "id": city.id,
        "name": city.name,
        "region": city.region,
        "is_active": city.is_active,
        "sort_order": city.sort_order,
        # Pydantic v2 serialises UTC datetimes with a trailing "Z" (not "+00:00").
        "created_at": _CREATED_AT.isoformat().replace("+00:00", "Z"),
        "updated_at": None,
    }


@pytest.mark.asyncio
async def test_list_cities__active_only__returns_sorted_list(client: AsyncClient, app) -> None:
    """Default request → 200 with the active cities in repository order."""
    # Arrange — repository already returns rows ordered by (sort_order, name).
    moscow = _city(id=1, name="Москва", region="Москва", sort_order=10)
    spb = _city(id=2, name="Санкт-Петербург", region="СПб", sort_order=20)
    kazan = _city(id=3, name="Казань", region="Татарстан", sort_order=30)
    session = _make_session([moscow, spb, kazan])

    async def _override():
        yield session

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    # Act
    resp = await client.get(PREFIX, headers={"Authorization": f"Bearer {_seller_token()}"})

    # Assert — whole body equals the CityRead projection, order preserved.
    assert resp.status_code == 200
    assert resp.json() == [_expected(moscow), _expected(spb), _expected(kazan)]


@pytest.mark.asyncio
async def test_list_cities__no_token__returns_401(client: AsyncClient) -> None:
    """Endpoint is token-gated — no Authorization header → 401."""
    resp = await client.get(PREFIX)

    assert resp.status_code == 401
    assert resp.json()["code"] == "AUTH_MISSING_TOKEN"


@pytest.mark.asyncio
async def test_list_cities__include_inactive_false__excludes_inactive(client: AsyncClient, app) -> None:
    """Without ``include_inactive`` the query must filter on ``is_active IS TRUE``.

    We assert on the compiled SELECT handed to ``session.execute`` (the I/O
    boundary) rather than relying on the mock to emulate filtering.
    """
    # Arrange
    session = _make_session([_city(id=1, name="Москва", region=None, sort_order=10)])

    async def _override():
        yield session

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    # Act
    resp = await client.get(PREFIX, headers={"Authorization": f"Bearer {_seller_token()}"})

    # Assert — the statement carries an is_active filter and the sort clause.
    assert resp.status_code == 200
    session.execute.assert_awaited_once()
    stmt = session.execute.await_args.args[0]
    compiled = str(stmt).lower()
    assert "is_active" in compiled
    assert "order by" in compiled
    assert "sort_order" in compiled


@pytest.mark.asyncio
async def test_list_cities__include_inactive_true__no_active_filter(client: AsyncClient, app) -> None:
    """With ``include_inactive=true`` the is_active filter is dropped."""
    # Arrange
    session = _make_session(
        [
            _city(id=1, name="Москва", region=None, sort_order=10),
            _city(id=2, name="Старый", region=None, sort_order=20, is_active=False),
        ]
    )

    async def _override():
        yield session

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    # Act
    resp = await client.get(
        PREFIX,
        params={"include_inactive": "true"},
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )

    # Assert — no WHERE is_active clause; inactive row is returned to the client.
    assert resp.status_code == 200
    stmt = session.execute.await_args.args[0]
    assert "where" not in str(stmt).lower()
    assert [c["id"] for c in resp.json()] == [1, 2]
