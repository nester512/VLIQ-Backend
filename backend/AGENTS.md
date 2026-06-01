# VLIQ Backend — контекст для агентов

FastAPI + SQLAlchemy 2.0 async + asyncpg + Alembic. Python 3.12. Poetry.
Telegram Mini App backend для мотивационной программы продавцов: загрузка чеков → проверка через ФНС/OFD → начисление бонусов → выплаты.

## Где что лежит

| Путь | Назначение |
|------|------------|
| `src/app/` | FastAPI приложение: `main.py` (create_app), `settings.py`, `depends.py` (engine/session DI), `api/v1.py` (router registration), `auth/` (JWT), `postgres/base.py` (BaseModel, IDModel, TimeStampedModel) |
| `src/<entity>/` | DDD-модули per сущность: `models.py`, `repository.py`, `depends.py`, `schemas/api.py`, `handlers/api/v1/router.py` |
| `migrations/alembic/` | Alembic env + versions (async support) |
| `.cursor/rules/*.mdc` | Стандарты кода (Python dev/tests/functional, performance, devops) |
| `.cursor/commands/*.md` | `/branch`, `/switch-branch`, `/push`, `/code-review`, `/respond-to-review`, `/work-item` |
| `.cursor/agents/*.md` | `code-reviewer`, `python-service-dev`, `python-test-qa` |

## Текущее состояние (2026-05-24)

**Скаффолд:** 3 из 54 эндпоинтов реализованы (`POST /auth/login`, `GET /auth/info`, `POST /sellers/tg-upsert`). Остальные возвращают 501. Initial Alembic migration не сгенерирована.

**Согласованная схема БД:** см. `erd.md` (10 таблиц, 3NF с прагматичной денормализацией). Схема финальная — менять не предлагать без явной просьбы.

**Punch-list ревью:** `../docs/reviews/00-PUNCH-LIST.md` — 8 BLOCKERS, 30+ HIGH/MEDIUM пунктов.

## Минимальный чеклист после правок

1. **Линт и типы:** `poetry run ruff check src tests`, `poetry run mypy src` (когда добавится mypy-config).
2. **Тесты:** `poetry run pytest -q --tb=short --disable-warnings` (когда добавятся).
3. **Миграции:** при изменении моделей — `poetry run alembic revision --autogenerate -m "describe"` + ревью diff'а.
4. **Не коммить:** `.env` (там реальный секрет), `__pycache__/`, `.idea/`.

## Конвенции этого репо

- **Линия 120 символов** (`tool.black.line-length = 120`).
- **`from __future__ import annotations`** в `models.py` и других модулях с forward refs.
- **Async везде:** `async def`, `AsyncSession`, `await session.execute(...)`.
- **DI через FastAPI `Depends`** — никакого глобального state, кроме `app.state` (после реализации lifespan).
- **Транзакции в сервис-слое, не в репозитории** — `async with session.begin()`.
- **structlog** для всех логов (после миграции с stdlib `logging`).
- **JSONB через `from sqlalchemy.dialects.postgresql import JSONB`** — не `JSON`.
- **Enum:** `SAEnum(MyEnum, name="my_enum", schema=DEFAULT_SCHEMA, values_callable=lambda x: [e.value for e in x])`.
- **Timestamp:** `TIMESTAMP(timezone=True)` всегда, `server_default=func.now()` + `onupdate=func.current_timestamp()`.
- **FK с `ondelete`:** `RESTRICT` для справочников (brand), `CASCADE` для подчинённых (seller → receipt items).

## Связанные репо

- **Frontend:** `../frontend/` — Vite + React 18 + TypeScript + Tailwind + `@telegram-apps/sdk-react` + TanStack Query (см. `../docs/reviews/07-frontend-plan.md`).
- **Документы:** `../docs/` — ТЗ, use cases, прототип HTML, 7 файлов ревью.

## Удалённые

Основная ветка: `main`. PRs через GitHub (`gh pr create`).
