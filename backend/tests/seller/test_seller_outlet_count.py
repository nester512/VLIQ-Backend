"""Validation for the required 1..1000 outlet-count registration field."""

import pytest
from pydantic import ValidationError
from src.seller.schemas.api import SellerUpdate


@pytest.mark.parametrize("outlet_count", [1, 1000])
def test_seller_update__outlet_count_in_range__accepted(outlet_count: int) -> None:
    assert SellerUpdate(outlet_count=outlet_count).outlet_count == outlet_count


@pytest.mark.parametrize("outlet_count", [0, 1001])
def test_seller_update__outlet_count_outside_range__rejected(outlet_count: int) -> None:
    with pytest.raises(ValidationError):
        SellerUpdate(outlet_count=outlet_count)


def test_seller_update__consent_timestamp_is_not_a_profile_field() -> None:
    """The registration only validates local checkboxes; consent facts are not stored."""
    payload = SellerUpdate(consent_pdn_at="2026-07-30T12:00:00Z")
    assert "consent_pdn_at" not in payload.model_dump()
