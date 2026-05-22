"""JWT auth — same shape as TopApp (HS256, Bearer, 6-day lifetime).

Adapted: TopApp issues tokens for User|Client; here we issue for Admin|Seller.
Token claims are identical: uid, iat, exp, user_id, role.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TypedDict, Union, cast

import structlog
from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from starlette import status

from src.admin.models import Admin
from src.app.depends import get_config
from src.seller.models import Seller

logger = structlog.get_logger(__name__)


class JwtTokenT(TypedDict):
    uid: str
    iat: int
    exp: int
    user_id: int  # telegram_id (PK of Admin or Seller)
    role: str  # "admin" | "super_admin" | "seller"


@dataclass
class JwtAuth:
    secret: str
    algorithm: str = "HS256"
    lifetime: timedelta = timedelta(days=6)

    def create_token(self, user: Union[Admin, Seller]) -> str:
        now = datetime.now(timezone.utc)

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
        }
        return jwt.encode(payload, self.secret, algorithm=self.algorithm)

    def validate_token(self, request: Request) -> JwtTokenT:
        authorization = request.headers.get("Authorization") or request.headers.get("authorization")

        if authorization is None:
            logger.warning("auth.validate_token.missing_header")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Отсутствует заголовок Authorization. Используйте формат: Authorization: Bearer <token>",
                headers={"WWW-Authenticate": "Bearer"},
            )

        try:
            parts = authorization.split(" ", 1)
            if len(parts) != 2:
                raise ValueError("Неверный формат заголовка Authorization. Ожидается: Bearer <token>")

            scheme, token = parts
            if scheme.lower() != "bearer":
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f'Неверная схема авторизации. Ожидается "Bearer", получено "{scheme}"',
                    headers={"WWW-Authenticate": "Bearer"},
                )

            if not token or not token.strip():
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Токен не может быть пустым",
                    headers={"WWW-Authenticate": "Bearer"},
                )

            claims = cast(JwtTokenT, jwt.decode(token.strip(), self.secret, algorithms=[self.algorithm]))

            for field in ("user_id", "role", "exp"):
                if field not in claims:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail=f"Токен не содержит обязательного поля: {field}",
                        headers={"WWW-Authenticate": "Bearer"},
                    )

            return claims

        except HTTPException:
            raise
        except jwt.ExpiredSignatureError:
            logger.warning("auth.validate_token.expired")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Токен истёк. Пожалуйста, авторизуйтесь заново",
                headers={"WWW-Authenticate": "Bearer"},
            )
        except (ValueError, KeyError, JWTError) as e:
            logger.warning("auth.validate_token.error", error=str(e), error_type=type(e).__name__)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Ошибка при валидации токена: {e}",
                headers={"WWW-Authenticate": "Bearer"},
            )


settings = get_config()
jwt_auth = JwtAuth(secret=settings.JWT_SECRET_SALT)

# Bearer scheme — only for Swagger UI to render the "Authorize" button.
# Real validation runs against request.headers in validate_token().
security_scheme = HTTPBearer(auto_error=False)


def validate_token_dependency(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(security_scheme),
) -> JwtTokenT:
    return jwt_auth.validate_token(request)


def require_admin(token: JwtTokenT = Depends(validate_token_dependency)) -> JwtTokenT:
    if token.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Требуется роль admin")
    return token


def require_super_admin(token: JwtTokenT = Depends(validate_token_dependency)) -> JwtTokenT:
    if token.get("role") != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Требуется роль super_admin")
    return token


def require_seller(token: JwtTokenT = Depends(validate_token_dependency)) -> JwtTokenT:
    if token.get("role") != "seller":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Требуется роль seller")
    return token
