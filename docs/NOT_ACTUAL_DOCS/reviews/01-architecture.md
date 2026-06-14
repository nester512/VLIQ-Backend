# Ревью 1: Архитектура и качество кода

> Агент: senior Python/FastAPI ревьюер (Sonnet). Сгенерировано 2026-05-24.

## Хорошее

1. **DDD per-entity структура** чёткая и консистентная. Каждый домен имеет `models.py`, `schemas/api.py`, `handlers/api/v1/router.py`. Разделение concerns соблюдено — router не лезет в репозиторий напрямую, а через depends. Масштабируется хорошо.
2. **Иерархия базовых классов** (`intpk`, `BaseModel`, `TimeStampedModel`, `IDModel` в `src/app/postgres/base.py`) с единым `naming_convention` для индексов/FK — правильный подход, Alembic будет генерировать чистые миграции.
3. **`lru_cache` на `get_engine_by_dsn` применён правильно** (`src/app/depends.py:20`). Engine — дорогой singleton, кешировать по DSN-строке — идиоматично. Пул `pool_size=20, max_overflow=0` — разумный консервативный дефолт.
4. **`from __future__ import annotations`** используется в нужных местах (models, repository, jwt). `pyproject.toml` с `ruff` + правильным `select` — хорошая база линтера.
5. **Alembic env.py** (`migrations/alembic/env.py`) — async-миграции реализованы правильно через `async_engine_from_config`, схема vliq изолирована через `include_object`.

## Критично

**C1.** `get_config()` без кеша создаёт новый `Settings()` на каждый запрос (`src/app/depends.py:15-16`). `Settings()` читает `.env` и валидирует через Pydantic при каждом вызове. Нужно добавить `@lru_cache`.

**C2.** `async_sessionmaker` создаётся на каждый запрос (`src/app/depends.py:36`). Это фабрика, её нужно создать один раз вместе с engine. Правильное решение: использовать `lifespan` в `create_app` и хранить фабрику в `app.state`.

**C3.** `ensure_seller` управляет транзакцией сам (`src/seller/repository.py:51,79`). Репозиторий вызывает `commit()` внутри метода — нарушение принципа "unit of work ownership". Когда будет бизнес-логика (создать seller + записать в audit_log в одной транзакции), это сделать невозможно. Транзакцией должен управлять caller (handler или service layer).

**C4.** `with suppress(Exception)` при rollback скрывает исключения (`src/seller/repository.py:61,83`). Если rollback упадёт (например, соединение уже мертво), ошибка молча проглочена. Нужно хотя бы логировать.

**C5.** `JWT_SECRET_SALT = "change-me-in-prod"` — хардкод в `Settings` (`src/app/settings.py:24`). Даже с дефолтом это опасно: если `.env` не задан, приложение стартует с известным секретом. Убрать дефолт.

**C6.** `settings = get_config()` на уровне модуля в `jwt.py` (`src/app/auth/jwt.py:122`). `jwt_auth` создаётся при импорте, до того как может быть переопределён `.env` в тестах. Это делает unit-тесты с другим секретом невозможными без monkey-patching.

## Стоит улучшить (по приоритету)

**П1.** Нет единого exception handler для Pydantic `ValidationError`. При невалидном теле FastAPI сам вернёт 422, но формат ответа не кастомизирован. Нет handler для непойманных `Exception` → 500 будет отдавать traceback в dev-режиме.

**П2.** `structlog` установлен, но используется только в `jwt.py` и `auth/router.py`. В `repository.py` — `logging.getLogger(__name__)` (stdlib). Смешение двух систем логирования — антипаттерн.

**П3.** `src/app/api/v1.py:16` — `Settings()` создаётся на уровне модуля для `PATH_PREFIX`. Это второй экземпляр settings. Использовать `get_config()` с `lru_cache` или константу.

**П4.** `auth/router.py` содержит inline-запросы к БД (`_find_admin`, `_find_seller`) вместо использования репозиториев. При появлении `AdminRepository` и `SellerRepository` это будет дублирование.

**П5.** `SellerRead` возвращает `payout_encrypted` (`src/seller/schemas/api.py:82`). Архитектурная ошибка: данные не должны быть в дефолтном Read-схеме, нужна отдельная `SellerReadSensitive`.

**П6.** `src/app/main.py` не имеет `lifespan`. Graceful shutdown engine (`await engine.dispose()`) не реализован. Под нагрузкой при перезапуске возможны утечки соединений.

**П7.** `CreateTableNameMixin` и `ModelDumpMixin` объявлены в `base.py`, но `IDModel` их наследует, а `Seller` и `Admin` наследуют `BaseModel` напрямую — теряют `model_dump`. Несогласованность иерархии.

## Что добавить

1. **`lifespan` в `create_app`** — инициализация engine/sessionmaker в `app.state`, dispose при shutdown.
2. **Base `AbstractRepository[T]`** с методами `get_by_id`, `create`, `update`, `delete` — избежать копипасты в 10 репозиториях.
3. **Middleware: `X-Request-ID`** — генерация UUID per-request, добавление в structlog context и response headers.
4. **Тесты (первоочередные):** `test_ensure_seller_race_condition`, `test_ensure_seller_update_fields`, `test_login_blocked_seller`. Нужны `pytest-asyncio`, `httpx.AsyncClient`, `pytest-postgresql` или `testcontainers`.
5. **`httpx` + `anyio`** в dev-dependencies для интеграционных тестов хендлеров через `AsyncClient(app=app)`.
6. **Отдельный `conftest.py`** с фикстурой сессии через testcontainers — без этого тесты репозитория невозможны.
