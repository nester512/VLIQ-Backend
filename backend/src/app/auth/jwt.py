"""JWT auth — same shape as TopApp (HS256, Bearer, 6-day lifetime).

Adapted: TopApp issues tokens for User|Client; here we issue for Admin|Seller.
Token claims are identical: uid, iat, exp, user_id, role.

A token only proves who logged in and when. Every request also re-checks the account
against the database (``check_account_access``): a block, a switched-off admin, a changed
admin role or a moved seller login take effect at once, not when the token expires.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import NotRequired, TypedDict, cast

import structlog
from fastapi import Depends, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.models import Admin
from src.app.depends import get_config, get_pg_session
from src.app.errors import AppError
from src.seller.models import Seller, SellerStatus

logger = structlog.get_logger(__name__)


class JwtTokenT(TypedDict):
    uid: str
    iat: int
    exp: int
    user_id: int  # telegram_id (PK of Admin or Seller)
    role: str  # "admin" | "super_admin" | "seller"
    login_id: NotRequired[int]  # Telegram account that logged in (≠ user_id after account recovery)


@dataclass
class JwtAuth:
    secret: str
    algorithm: str = "HS256"
    lifetime: timedelta = timedelta(days=6)

    def create_token(self, user: Admin | Seller, *, login_telegram_id: int | None = None) -> str:
        """``login_telegram_id``: the Telegram account that actually logged in, when it differs
        from the seller's own id (account recovery) — lets a switched-off lost account's
        tokens be told apart from the recovered one's."""
        now = datetime.now(UTC)

        if isinstance(user, Admin):
            role = getattr(user.role, "value", str(user.role))
            user_id = user.telegram_id
        elif isinstance(user, Seller):
            role = "seller"
            user_id = user.telegram_id
        else:
            raise TypeError(f"Unsupported subject type for JWT: {type(user).__name__}")

        payload: JwtTokenT = {
            "uid": uuid.uuid4().hex,
            "iat": int(now.timestamp()),
            "exp": int((now + self.lifetime).timestamp()),
            "user_id": user_id,
            "role": str(role),
            "login_id": login_telegram_id if login_telegram_id is not None else user_id,
        }
        return jwt.encode(payload, self.secret, algorithm=self.algorithm)

    def validate_token(self, request: Request) -> JwtTokenT:
        authorization = request.headers.get("Authorization") or request.headers.get("authorization")

        if authorization is None:
            logger.warning("auth.validate_token.missing_header")
            raise AppError("AUTH_MISSING_TOKEN", status_code=401)

        _BEARER_PARTS = 2
        try:
            parts = authorization.split(" ", 1)
            if len(parts) != _BEARER_PARTS:
                raise ValueError("Неверный формат заголовка Authorization. Ожидается: Bearer <token>")

            scheme, token = parts
            if scheme.lower() != "bearer":
                raise AppError("AUTH_MISSING_TOKEN", status_code=401)

            if not token or not token.strip():
                raise AppError("AUTH_MISSING_TOKEN", status_code=401)

            claims = cast(JwtTokenT, jwt.decode(token.strip(), self.secret, algorithms=[self.algorithm]))

            for field in ("user_id", "role", "exp"):
                if field not in claims:
                    raise AppError("AUTH_TOKEN_INVALID", status_code=401)

            return claims

        except AppError:
            raise
        except jwt.ExpiredSignatureError:
            logger.warning("auth.validate_token.expired")
            raise AppError("AUTH_TOKEN_EXPIRED", status_code=401)
        except (ValueError, KeyError, JWTError) as e:
            logger.warning("auth.validate_token.error", error=str(e), error_type=type(e).__name__)
            raise AppError("AUTH_TOKEN_INVALID", status_code=401)


settings = get_config()
jwt_auth = JwtAuth(secret=settings.JWT_SECRET_SALT)

# Bearer scheme — only for Swagger UI to render the "Authorize" button.
# Real validation runs against request.headers in validate_token().
security_scheme = HTTPBearer(auto_error=False)


def decode_token_dependency(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(security_scheme),
) -> JwtTokenT:
    return jwt_auth.validate_token(request)


async def check_account_access(token: JwtTokenT, session: AsyncSession) -> None:
    """Refuse a still-valid token whose account has changed since the login.

    - seller blocked → 403 SELLER_BLOCKED (viewing too, decision В-1);
    - the seller's own Telegram account switched off by account recovery → 403 ACCOUNT_MOVED
      (the recovered account's tokens carry another ``login_id`` and pass);
    - admin switched off → 403 ADMIN_DISABLED;
    - account gone or admin role changed → 401 AUTH_TOKEN_STALE: the app logs in again and
      gets a token for what the account is now.
    """
    # The read autobegins a transaction on the request-scoped session; end the one we
    # started so handlers can still open their own `async with session.begin()`.
    started_here = not session.in_transaction()
    user_id = token["user_id"]
    try:
        if token["role"] == "seller":
            status = await session.scalar(select(Seller.status).where(Seller.telegram_id == user_id))
            moved = False
            if status not in (None, SellerStatus.blocked.value) and token.get("login_id", user_id) == user_id:
                moved = await session.scalar(select(Seller.primary_login_disabled).where(Seller.telegram_id == user_id))
            admin = None
        else:
            row = (
                await session.execute(select(Admin.is_active, Admin.role).where(Admin.telegram_id == user_id))
            ).first()
            admin = (row[0], getattr(row[1], "value", row[1])) if row is not None else None
    finally:
        if started_here:
            await session.rollback()

    if token["role"] == "seller":
        if status is None:
            raise AppError("AUTH_TOKEN_STALE", status_code=401)
        if status == SellerStatus.blocked.value:
            raise AppError("SELLER_BLOCKED", status_code=403)
        if moved is True:
            raise AppError("ACCOUNT_MOVED", status_code=403)
        return
    if admin is None:
        raise AppError("AUTH_TOKEN_STALE", status_code=401)
    is_active, role = admin
    if not is_active:
        raise AppError("ADMIN_DISABLED", status_code=403)
    if role != token["role"]:
        raise AppError("AUTH_TOKEN_STALE", status_code=401)


async def account_access_dependency(
    token: JwtTokenT = Depends(decode_token_dependency),
    session: AsyncSession = Depends(get_pg_session),
) -> None:
    await check_account_access(token, session)


def validate_token_dependency(
    token: JwtTokenT = Depends(decode_token_dependency),
    _access: None = Depends(account_access_dependency),
) -> JwtTokenT:
    """The current user's token — signature, expiry AND the account as it is now."""
    return token


def require_admin(token: JwtTokenT = Depends(validate_token_dependency)) -> JwtTokenT:
    if token.get("role") not in ("admin", "super_admin"):
        raise AppError("AUTH_FORBIDDEN", status_code=403)
    return token


def require_super_admin(token: JwtTokenT = Depends(validate_token_dependency)) -> JwtTokenT:
    if token.get("role") != "super_admin":
        raise AppError("AUTH_FORBIDDEN", status_code=403)
    return token


def require_seller(token: JwtTokenT = Depends(validate_token_dependency)) -> JwtTokenT:
    if token.get("role") != "seller":
        raise AppError("AUTH_FORBIDDEN", status_code=403)
    return token
