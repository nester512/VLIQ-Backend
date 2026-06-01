"""OFD response data models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class OFDItem(BaseModel):
    """Single line item from an OFD receipt."""

    name: str = Field(..., description="Product/service name as reported by OFD")
    quantity: float = Field(..., ge=0, description="Quantity sold")
    price: int = Field(..., ge=0, description="Unit price in kopecks")
    total: int = Field(..., ge=0, description="Line total in kopecks (quantity × price)")
    nds_rate: int | None = Field(default=None, description="VAT rate in percent, if provided")


class OFDReceipt(BaseModel):
    """Full receipt data from an OFD provider."""

    fn: str = Field(..., description="Fiscal number (ФН)")
    fd: str = Field(..., description="Fiscal document number (ФД)")
    fp: str = Field(..., description="Fiscal sign (ФП / ФПД)")

    total_sum: int = Field(..., ge=0, description="Total receipt sum in kopecks")
    purchase_date: datetime = Field(..., description="Purchase timestamp with timezone")

    shop_name: str | None = Field(default=None)
    shop_inn: str | None = Field(default=None)
    shop_address: str | None = Field(default=None)

    items: list[OFDItem] = Field(default_factory=list)

    raw_response: dict | None = Field(
        default=None,
        description="Unmodified provider JSON for audit purposes",
    )
