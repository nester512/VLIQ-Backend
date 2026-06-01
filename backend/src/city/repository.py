"""City reference-data queries.

The city dictionary is the source of truth for the seller registration form:
the frontend renders the dropdown from ``GET /cities`` and the backend validates
that a submitted ``seller.city`` belongs to the (active) dictionary.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.city.models import City


async def city_name_is_valid(session: AsyncSession, name: str) -> bool:
    """True when ``name`` matches an active city in the dictionary (exact match)."""
    stmt = select(func.count()).select_from(City).where(City.name == name, City.is_active.is_(True))
    return (await session.execute(stmt)).scalar_one() > 0
