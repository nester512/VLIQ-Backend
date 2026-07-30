from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Annotated
from urllib.parse import parse_qsl, unquote

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.models import Admin
from src.app.auth.jwt import JwtTokenT, jwt_auth, validate_token_dependency
from src.app.base_settings import Env
from src.app.depends import get_config, get_pg_session
from src.app.errors import AppError
from src.app.middleware.rate_limit import limiter
from src.app.settings import Settings
from src.auth.schemas.api import (
    AdminInfoResponse,
    InfoResponse,
    LoginRequest,
    LoginResponse,
    SellerInfoResponse,
    TmaVerifyRequest,
)
from src.seller.models import Seller

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["Auth"])

# Fixed local-only identity used by the floating DEV panel. Keeping the ID on
# the server (rather than accepting it from the client) makes it impossible for
# this helper to delete an arbitrary seller even in a non-production environment.
_DEV_REGISTRATION_SELLER_ID = 42424242


async def _find_admin(session: AsyncSession, telegram_id: int) -> Admin | None:
    res = await session.execute(select(Admin).where(Admin.telegram_id == telegram_id))
    return res.scalars().first()


async def _find_seller(session: AsyncSession, telegram_id: int) -> Seller | None:
    res = await session.execute(select(Seller).where(Seller.telegram_id == telegram_id))
    return res.scalars().first()


async def _issue_token_for_telegram_id(
    telegram_id: int,
    session: AsyncSession,
) -> LoginResponse:
    """Shared logic: look up Admin then Seller and issue JWT."""
    admin = await _find_admin(session, telegram_id)
    if admin is not None:
        if not admin.is_active:
            raise AppError("AUTH_FORBIDDEN", status_code=403)
        token = jwt_auth.create_token(admin)
        logger.info("auth.login.admin", telegram_id=telegram_id, role=admin.role)
        return LoginResponse(access_token=token, role=admin.role)  # type: ignore[arg-type]

    seller = await _find_seller(session, telegram_id)
    if seller is not None:
        if seller.status == "blocked":
            raise AppError("SELLER_BLOCKED", status_code=403)
        token = jwt_auth.create_token(seller)
        logger.info("auth.login.seller", telegram_id=telegram_id)
        return LoginResponse(access_token=token, role="seller")

    # Auto-create seller on first TMA login (status=pending, RegPage completes the profile).
    # The phone column is UNIQUE NOT NULL but the Pydantic E.164 validator
    # (`^\+[1-9]\d{7,14}$`) rejects synthetic placeholders. We mint a
    # validator-compliant unique stub by prefixing the telegram_id with `+99`
    # — outside any allocated country prefix yet pattern-valid — and the
    # RegPage flow overwrites it the moment the user submits the form.
    digits = str(telegram_id)[:13]  # keep total length ≤ 15 chars (E.164 cap)
    new_seller = Seller(
        telegram_id=telegram_id,
        brand_id=1,  # TODO: derive from TMA start_param or bot context
        phone_e164=f"+99{digits}",
        status="pending",
    )
    session.add(new_seller)
    try:
        await session.commit()
        await session.refresh(new_seller)
    except Exception:
        await session.rollback()
        raise
    token = jwt_auth.create_token(new_seller)
    logger.info("auth.login.seller_autocreated", telegram_id=telegram_id)
    return LoginResponse(access_token=token, role="seller")


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="[DEV ONLY] Логин по telegram_id — отключён в проде",
    description=(
        "**Deprecated** для production. "
        "Используйте `POST /auth/tma-verify` для входа через Telegram Mini App. "
        "В prod-окружении возвращает 404."
    ),
)
@limiter.limit("10/minute")
async def login(
    request: Request,
    body: LoginRequest,
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    cfg: Annotated[Settings, Depends(get_config)],
) -> LoginResponse:
    # H1 note: disable dev-only login in prod.
    if cfg.env == Env.prod:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")  # intentional 404, not AppError
    return await _issue_token_for_telegram_id(body.id, session)


@router.delete(
    "/dev/mock-registration-seller",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="[DEV ONLY] Удалить временного продавца для проверки регистрации",
)
async def reset_mock_registration_seller(
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    cfg: Annotated[Settings, Depends(get_config)],
) -> None:
    """Remove only the fixed DEV registration identity and its cascaded test data."""
    if cfg.env == Env.prod:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")  # intentional 404, not AppError

    await session.execute(delete(Seller).where(Seller.telegram_id == _DEV_REGISTRATION_SELLER_ID))
    await session.commit()


@router.post(
    "/tma-verify",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
    summary="Верификация Telegram initData HMAC и выдача JWT",
    description=(
        "Принимает `initData` из `Telegram.WebApp.initData`, "
        "проверяет HMAC-SHA256 подпись с ключом, производным от `TG_BOT_TOKEN`, "
        "и возвращает JWT-токен для авторизации в API."
    ),
)
@limiter.limit("10/minute")
async def tma_verify(
    request: Request,
    body: TmaVerifyRequest,
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    cfg: Annotated[Settings, Depends(get_config)],
) -> LoginResponse:
    """B1: Validate Telegram initData HMAC and issue JWT."""
    if not cfg.TG_BOT_TOKEN:
        logger.error("auth.tma_verify.no_bot_token")
        raise AppError("INTERNAL_ERROR", status_code=500)

    # Parse query string, extracting hash separately.
    params = dict(parse_qsl(body.init_data, keep_blank_values=True))
    received_hash = params.pop("hash", None)
    if not received_hash:
        raise AppError("AUTH_INVALID_INIT_DATA", status_code=400)

    # Build data-check-string: sorted key=value pairs joined by \n.
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))

    # Derive secret key per Telegram spec: "WebAppData" is the HMAC key, bot_token is the payload.
    # https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    # > "...HMAC-SHA-256 signature with the constant string 'WebAppData' used as a key
    # >  and the bot's token as the payload."
    secret_key = hmac.new(
        key=b"WebAppData",
        msg=cfg.TG_BOT_TOKEN.encode(),
        digestmod=hashlib.sha256,
    ).digest()

    # Compute expected hash.
    expected_hash = hmac.new(
        key=secret_key,
        msg=data_check_string.encode(),
        digestmod=hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        logger.warning("auth.tma_verify.invalid_hash")
        raise AppError("AUTH_INVALID_INIT_DATA", status_code=401)

    # Anti-replay: Telegram considers initData stale after 24 hours.
    _TMA_MAX_AGE_SECONDS = 86400  # 24 h — Telegram's official expiry window
    try:
        auth_date = int(params.get("auth_date", "0"))
    except ValueError:
        raise AppError("AUTH_INVALID_INIT_DATA", status_code=400) from None
    if auth_date <= 0 or time.time() - auth_date > _TMA_MAX_AGE_SECONDS:
        logger.warning("auth.tma_verify.stale_auth_date", auth_date=auth_date)
        raise AppError("AUTH_TOKEN_EXPIRED", status_code=401)

    # Extract user JSON from params.
    user_json = params.get("user")
    if not user_json:
        raise AppError("AUTH_INVALID_INIT_DATA", status_code=400)

    try:
        user_data = json.loads(unquote(user_json))
    except (ValueError, KeyError) as exc:
        logger.warning("auth.tma_verify.bad_user_json", error=str(exc))
        raise AppError("AUTH_INVALID_INIT_DATA", status_code=400) from exc

    telegram_id = user_data.get("id")
    if not telegram_id or not isinstance(telegram_id, int):
        raise AppError("AUTH_INVALID_INIT_DATA", status_code=400)

    logger.info("auth.tma_verify.ok", telegram_id=telegram_id)
    return await _issue_token_for_telegram_id(telegram_id, session)


@router.get(
    "/info",
    response_model=InfoResponse,
    summary="Получить профиль текущего авторизованного пользователя",
)
async def info(
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    token: Annotated[JwtTokenT, Depends(validate_token_dependency)],
) -> InfoResponse:
    role = token.get("role")
    user_id = token.get("user_id")

    if user_id is None:
        raise AppError("AUTH_INVALID_INIT_DATA", status_code=401)

    if role in ("admin", "super_admin"):
        admin = await _find_admin(session, user_id)
        if admin is None:
            raise AppError("SELLER_NOT_FOUND", status_code=404)
        return AdminInfoResponse.model_validate(admin, from_attributes=True)

    if role == "seller":
        seller = await _find_seller(session, user_id)
        if seller is None:
            raise AppError("SELLER_NOT_REGISTERED", status_code=404)
        return SellerInfoResponse.model_validate(seller, from_attributes=True)

    raise AppError("AUTH_INVALID_INIT_DATA", status_code=401)
