from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.models import Admin
from src.app.auth.jwt import JwtTokenT, jwt_auth, validate_token_dependency
from src.app.depends import get_pg_session
from src.auth.schemas.api import (
    AdminInfoResponse,
    InfoResponse,
    LoginRequest,
    LoginResponse,
    SellerInfoResponse,
)
from src.seller.models import Seller

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["Auth"])


async def _find_admin(session: AsyncSession, telegram_id: int) -> Admin | None:
    res = await session.execute(select(Admin).where(Admin.telegram_id == telegram_id))
    return res.scalars().first()


async def _find_seller(session: AsyncSession, telegram_id: int) -> Seller | None:
    res = await session.execute(select(Seller).where(Seller.telegram_id == telegram_id))
    return res.scalars().first()


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Логин по telegram_id (ищет сначала среди Admin, затем среди Seller)",
)
async def login(
    body: LoginRequest,
    session: Annotated[AsyncSession, Depends(get_pg_session)],
) -> LoginResponse:
    admin = await _find_admin(session, body.id)
    if admin is not None:
        if not admin.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Учётная запись администратора деактивирована")
        token = jwt_auth.create_token(admin)
        logger.info("auth.login.admin", telegram_id=body.id, role=admin.role)
        return LoginResponse(access_token=token, role=admin.role)  # type: ignore[arg-type]

    seller = await _find_seller(session, body.id)
    if seller is not None:
        if seller.status == "blocked":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Seller заблокирован")
        token = jwt_auth.create_token(seller)
        logger.info("auth.login.seller", telegram_id=body.id)
        return LoginResponse(access_token=token, role="seller")

    raise HTTPException(
        status.HTTP_404_NOT_FOUND,
        detail=f"Пользователь с telegram_id={body.id} не найден ни среди администраторов, ни среди sellers",
    )


@router.get(
    "/info",
    response_model=InfoResponse,
    summary="Получить профиль текущего авторизованного пользователя",
)
async def info(
    session: Annotated[AsyncSession, Depends(get_pg_session)],
    token: JwtTokenT = Depends(validate_token_dependency),
) -> InfoResponse:
    role = token.get("role")
    user_id = token.get("user_id")

    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Токен не содержит user_id")

    if role in ("admin", "super_admin"):
        admin = await _find_admin(session, user_id)
        if admin is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Admin с telegram_id={user_id} не найден")
        return AdminInfoResponse.model_validate(admin, from_attributes=True)

    if role == "seller":
        seller = await _find_seller(session, user_id)
        if seller is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Seller с telegram_id={user_id} не найден")
        return SellerInfoResponse.model_validate(seller, from_attributes=True)

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Неизвестная роль в токене: {role}")
