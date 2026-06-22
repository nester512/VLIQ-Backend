from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx
import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.app import models_registry  # noqa: F401 — registers all ORM models with metadata
from src.app.api.v1 import router as v1_router
from src.app.base_settings import Env
from src.app.depends import get_config, get_engine_by_dsn
from src.app.errors import AppError
from src.app.middleware.rate_limit import setup_rate_limiting
from src.app.settings import Settings
from src.app.telegram_bot import TelegramBotClient
from src.receipt_ocr.storage import S3FileStorage, get_receipt_storage

logger = structlog.get_logger(__name__)

config: Settings = get_config()


# H16: Lifespan — engine and sessionmaker live in app.state, disposed on shutdown.
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    engine = get_engine_by_dsn(config.postgres.POSTGRES_URL)
    app.state.engine = engine
    app.state.sessionmaker = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    # Shared httpx client — retries 3x via transport for Telegram API calls.
    transport = httpx.AsyncHTTPTransport(retries=3)
    http_client = httpx.AsyncClient(timeout=10.0, transport=transport)
    app.state.http_client = http_client

    # Telegram Bot client — used by NotificationSender and webhook handler.
    if config.TG_BOT_TOKEN:
        app.state.bot = TelegramBotClient(config.TG_BOT_TOKEN, http_client)
        logger.info("app.lifespan.telegram_bot_ready")
    else:
        app.state.bot = None
        logger.warning("app.lifespan.no_tg_bot_token — notifications will be skipped")

    # arq pool — used by upload handler to enqueue process_receipt_task.
    arq_pool = None
    try:
        from arq import create_pool
        from arq.connections import RedisSettings

        redis_settings = RedisSettings.from_dsn(config.REDIS_URL)
        arq_pool = await create_pool(redis_settings)
        app.state.arq_pool = arq_pool
        logger.info("app.lifespan.arq_pool_connected", redis_url=config.REDIS_URL)
    except Exception as exc:
        # Non-fatal — app starts without arq; uploads will log a warning.
        logger.warning("app.lifespan.arq_pool_failed", error=str(exc))
        app.state.arq_pool = None

    # Ensure S3 bucket exists on startup when using S3 storage backend.
    storage = get_receipt_storage()
    if isinstance(storage, S3FileStorage):
        try:
            await storage.ensure_bucket()
        except Exception:
            logger.warning("app.lifespan.ensure_bucket_failed — S3 may come up shortly", exc_info=True)

    logger.info("app.lifespan.startup", dsn_host=config.postgres.POSTGRES_URL.split("@")[-1])
    yield

    if arq_pool is not None:
        await arq_pool.close(True)
    await http_client.aclose()
    await engine.dispose()
    logger.info("app.lifespan.shutdown")


def setup_middleware(app: FastAPI, cfg: Settings) -> None:
    # B4: Use explicit origin list from settings; wildcard only if empty (dev convenience).
    allow_credentials = bool(cfg.cors_origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins if cfg.cors_origins else ["*"],
        allow_credentials=allow_credentials,
        allow_methods=cfg.cors_methods,
        allow_headers=cfg.cors_headers,
    )


def setup_routers(app: FastAPI) -> None:
    app.include_router(v1_router)

    @app.get("/health", tags=["System"])
    def get_health() -> dict:
        return {"result": "ok"}


# Only these structured keys from AppError.extra are ever returned to the client.
_SAFE_EXTRA_KEYS = frozenset({"existing_receipt_id"})

# Pydantic v2 error type → localized field message (no raw English ever surfaces).
_FIELD_ERROR_MESSAGES: dict[str, str] = {
    "missing": "Заполните это поле.",
    "string_too_short": "Слишком короткое значение.",
    "string_too_long": "Слишком длинное значение.",
    "too_short": "Слишком мало элементов.",
    "too_long": "Слишком много элементов.",
    "greater_than": "Значение слишком маленькое.",
    "greater_than_equal": "Значение слишком маленькое.",
    "less_than": "Значение слишком большое.",
    "less_than_equal": "Значение слишком большое.",
    "int_parsing": "Введите число.",
    "float_parsing": "Введите число.",
    "string_type": "Неверный формат значения.",
    "bool_parsing": "Неверный формат значения.",
    "value_error": "Неверное значение.",
}


def _localize_field_error(err_type: str) -> str:
    return _FIELD_ERROR_MESSAGES.get(err_type, "Проверьте это поле.")


def setup_exception_handlers(app: FastAPI, cfg: Settings) -> None:  # noqa: ARG001 — cfg kept for call-site compat
    # AppError → structured envelope with carried status_code.
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        debug_id = uuid.uuid4().hex
        content: dict = {
            "code": exc.code,
            "user_message": exc.user_message,
            "debug_id": debug_id,
        }
        # Only explicitly-safe structured keys are returned to the client; technical
        # details (e.g. a raw `reason`) stay in the logs, keyed by debug_id.
        safe_extra = {k: v for k, v in exc.extra.items() if k in _SAFE_EXTRA_KEYS}
        if safe_extra:
            content["extra"] = safe_extra
        logger.info(
            "app.app_error",
            code=exc.code,
            debug_id=debug_id,
            path=request.url.path,
            status_code=exc.status_code,
            extra_keys=list(exc.extra.keys()),
        )
        return JSONResponse(status_code=exc.status_code, content=content)

    # RequestValidationError → 422 with LOCALIZED field errors (never raw Pydantic
    # English `msg` or the request body, which may carry untrusted/sensitive input).
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        debug_id = uuid.uuid4().hex
        field_errors: dict[str, str] = {}
        for err in exc.errors():
            loc = [str(part) for part in err.get("loc", ()) if part not in ("body", "query", "path")]
            field = loc[-1] if loc else "body"
            field_errors.setdefault(field, _localize_field_error(str(err.get("type", ""))))
        logger.info("app.validation_error", debug_id=debug_id, path=request.url.path, fields=list(field_errors))
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_ERROR",
                "user_message": "Проверьте введённые данные.",
                "debug_id": debug_id,
                "field_errors": field_errors,
            },
        )

    # Catch-all — log the full traceback server-side; the client gets ONLY the
    # envelope (never a traceback or raw exception text).
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        debug_id = uuid.uuid4().hex
        logger.exception(
            "app.unhandled_exception",
            path=request.url.path,
            exc_type=type(exc).__name__,
            debug_id=debug_id,
        )
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "user_message": "Что-то пошло не так. Попробуйте ещё раз.",
                "debug_id": debug_id,
            },
        )


_ERROR_ENVELOPE_SCHEMA = {
    "description": "Structured error envelope returned by all error paths.",
    "content": {
        "application/json": {
            "schema": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "example": "SELLER_NOT_FOUND"},
                    "user_message": {"type": "string", "example": "Продавец не найден."},
                    "debug_id": {"type": "string", "example": "a1b2c3d4e5f6..."},
                    "extra": {"type": "object"},
                },
                "required": ["code", "user_message", "debug_id"],
            }
        }
    },
}


def create_app(*args, **kwargs) -> FastAPI:
    cfg: Settings = get_config()
    app = FastAPI(
        title="VLIQ Backend",
        description="Loyalty and bonus management backend for the VLIQ vape retailer Telegram Mini App.",
        version="0.1.0",
        # H7: Swagger only in non-prod environments.
        docs_url=None if cfg.env == Env.prod else "/swagger",
        redoc_url=None if cfg.env == Env.prod else "/redoc",
        lifespan=lifespan,
        responses={
            400: _ERROR_ENVELOPE_SCHEMA,
            401: _ERROR_ENVELOPE_SCHEMA,
            403: _ERROR_ENVELOPE_SCHEMA,
            404: _ERROR_ENVELOPE_SCHEMA,
            422: _ERROR_ENVELOPE_SCHEMA,
            500: _ERROR_ENVELOPE_SCHEMA,
        },
    )
    setup_middleware(app, cfg)
    setup_routers(app)
    setup_exception_handlers(app, cfg)
    # H6: Rate limiting — wired last so all routes exist when SlowAPI inspects them.
    setup_rate_limiting(app, cfg)
    # Observability: expose /metrics in Prometheus text format.
    Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=config.port)
