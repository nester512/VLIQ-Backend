from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from src.admin.schemas.api import AdminRead
from src.seller.schemas.api import SellerRead


class LoginRequest(BaseModel):
    id: int = Field(..., ge=1, description="Telegram ID (PK of Seller or Admin)")


class LoginResponse(BaseModel):
    access_token: str
    role: Literal["admin", "super_admin", "seller"]


class AdminInfoResponse(AdminRead):
    subject_type: Literal["admin"] = "admin"


class SellerInfoResponse(SellerRead):
    subject_type: Literal["seller"] = "seller"


InfoResponse = AdminInfoResponse | SellerInfoResponse


# B1: TMA initData verification request schema.
class TmaVerifyRequest(BaseModel):
    """Raw initData string from Telegram.WebApp.initData."""

    init_data: str = Field(..., description="Raw query string from Telegram.WebApp.initData")
