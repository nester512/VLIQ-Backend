# VLIQ — сводный punch-list по итогам ревью

> Источник: 5 ревью бэкенда (архитектура, БД, безопасность, антифрод, API) + 2 плана (OCR/ФНС, фронт).
> Дата: 2026-05-24. Детальные отчёты — в соседних файлах.

---

## 🔴 BLOCKER — фиксить до любой бизнес-логики

| # | Что | Где | Источник | Время |
|---|---|---|---|---|
| B1 | Нет валидации Telegram initData HMAC — любой клиент представится любым `telegram_id` | `src/auth/handlers/api/v1/router.py:37-65`. Добавить `POST /auth/tma-verify` с проверкой `hmac_sha256(initData, "WebAppData" key derived from bot_token)` | sec / api | 0.5д |
| B2 | `/sellers/tg-upsert` открыт всем — подмена данных чужого продавца | `src/seller/handlers/api/v1/router.py:12-29`. Закрыть `Depends(validate_token_dependency)`, проверять `token.user_id == body.id` | sec | 0.5д |
| B3 | `.env` закоммичен, нет `.gitignore` | `backend/.env`, `backend/.gitignore` отсутствует. Удалить из истории, ротировать `JWT_SECRET_SALT` | sec | 0.5д |
| B4 | CORS `allow_origins=["*"] + allow_credentials=True` | `src/app/main.py:11-17`. Список доменов из ENV | sec | 15м |
| B5 | Нет ни одной Alembic-миграции, БД не поднимается | `migrations/alembic/versions/` пуст. Сгенерировать initial + добавить `op.execute("CREATE SCHEMA IF NOT EXISTS vliq")` | db | 1ч |
| B6 | В `env.py` нет `compare_type=True` — autogenerate не видит изменение типов/enum | `migrations/alembic/env.py:56-64` | db | 5м |
| B7 | **Нет composite `UNIQUE(fn, fd, fp)`** — главная дыра антифрода | `src/receipt/models.py`. Добавить `UniqueConstraint('fn','fd','fp', postgresql_where=text('fn IS NOT NULL AND is_deleted = false'))` | db / fraud | 30м |
| B8 | `UNIQUE(qr_raw)` и `UNIQUE(file_hash)` не partial — soft-delete блокирует повторную загрузку правильного чека после `rejected` | `src/receipt/models.py:80,87`. Переделать на partial UNIQUE `WHERE is_deleted = false` | db / fraud | 30м |

---

## 🟠 HIGH — нужно для MVP

### Безопасность / auth
| # | Что | Где | Время |
|---|---|---|---|
| H1 | Заменить `python-jose` на `PyJWT≥2.8` (CVE algorithm confusion), явно `algorithms=["HS256"]` | `pyproject.toml`, `src/app/auth/jwt.py` | 1ч |
| H2 | `JWT_SECRET_SALT` — убрать дефолт из кода, требовать через ENV | `src/app/settings.py:24` | 5м |
| H3 | Refresh-токены + blacklist (Redis) | новый модуль | 1д |
| H4 | Реальное шифрование `payout_encrypted` (Fernet/AES-256-GCM), ключ из ENV | `src/seller/models.py`, новый `src/app/crypto.py` | 0.5д |
| H5 | `SellerRead` НЕ должен возвращать `payout_encrypted` | `src/seller/schemas/api.py:81` — убрать поле; завести `SellerReadSensitive` для админа | 15м |
| H6 | Rate limiting через `slowapi` + Redis: `/auth/login` 10/min/IP, `/sellers/tg-upsert` 5/min/IP, `/receipts/upload` 30/min/seller | `src/app/main.py` | 0.5д |
| H7 | Swagger закрывать в проде: `docs_url=None if env==prod else "/swagger"` | `src/app/main.py:32` | 5м |

### БД / индексы
| # | Что | Время |
|---|---|---|
| H8 | Hot-path индексы: `receipt(brand_id, status, created_at)`, `bonus_transaction(seller_id, brand_id, created_at)`, `seller(brand_id, status)`, `promotion(brand_id, status)`, `payout_request(seller_id, status)` | 1ч |
| H9 | GIN-индексы: `receipt.items`, `receipt.fraud_signals`, `sku.aliases` (OCR-матчинг иначе seqscan) | 30м |
| H10 | `audit_log(actor_id, actor_type, created_at)` и `(entity_type, entity_id)` | 15м |
| H11 | `Seller` наследует `BaseModel` напрямую и дублирует `created_at/updated_at` — выровнять с `TimeStampedModel` или вынести в общий миксин для PK ≠ id | 30м |

### Антифрод / транзакционность
| # | Что | Где | Время |
|---|---|---|---|
| H12 | Атомарность `approve receipt + INSERT bonus_transaction` в одной БД-транзакции с `SELECT … FOR UPDATE` на Receipt | новый `src/receipt/service.py` | 0.5д |
| H13 | Payout flow: `создание payout_request + INSERT payout_hold` атомарно. `paid → payout_completed`, `rejected → payout_reverted` — каждый переход в одной транзакции | новый `src/payout_request/service.py` | 0.5д |
| H14 | `ensure_seller`: при IntegrityError на `phone_e164` возвращать 409 «телефон уже привязан к другому telegram_id», а не 500 | `src/seller/repository.py:53-58` | 30м |
| H15 | Идемпотентность критичных POST (upload receipt, approve, request payout) — header `Idempotency-Key`, хранить хеши в Redis 24ч | middleware | 0.5д |

### Архитектура
| # | Что | Где | Время |
|---|---|---|---|
| H16 | `lifespan` в `create_app`: инициализация engine/sessionmaker в `app.state`, `await engine.dispose()` при shutdown | `src/app/main.py` | 1ч |
| H17 | `@lru_cache` на `get_config()` — сейчас `Settings()` пересоздаётся на каждый запрос | `src/app/depends.py:15` | 5м |
| H18 | `async_sessionmaker` кешировать (через `app.state` после lifespan) | `src/app/depends.py:36` | 30м |
| H19 | Убрать `commit()` из репозиториев — управление транзакцией в сервис-слое (UoW) | `src/seller/repository.py:51,79` | 1ч |
| H20 | Глобальные exception handlers: `RequestValidationError` → единый формат, `Exception` → 500 без traceback в проде | `src/app/main.py` | 30м |

### API-контракты
| # | Что | Где | Время |
|---|---|---|---|
| H21 | **`POST /receipts/upload`** (multipart: file + brand_id) — основной клиентский эндпоинт. Текущий JSON-`POST /receipts` бесполезен для TMA | `src/receipt/handlers/api/v1/router.py` | 1д |
| H22 | Action-эндпоинты: `POST /receipts/{id}/approve`, `/reject`, `/revise` — с проверкой state machine | там же | 0.5д |
| H23 | `GET /sellers/me`, `GET /sellers/me/balance`, `GET /sellers/me/receipts`, `GET /sellers/me/notifications` — без них TMA не работает | новые роуты | 0.5д |
| H24 | `ReceiptCreate` разнести: клиент шлёт только `file_kind` + файл, OCR-поля (`ocr_raw`, `fraud_signals`, `items`, `bonus_amount`, `status`) — внутренние | `src/receipt/schemas/api.py:26` | 30м |
| H25 | Query-параметры на GET-list: `?seller_id&brand_id&status&date_from&date_to&page&limit` | все `*/router.py` | 1д |
| H26 | Запретить `PATCH`/`DELETE` на `audit_log` и `bonus_transaction` (append-only) — вернуть 405 | соответствующие роуты | 15м |

### Валидация
| # | Что | Где | Время |
|---|---|---|---|
| H27 | `phone_e164: Field(pattern=r"^\+[1-9]\d{7,14}$")` | seller, admin schemas | 10м |
| H28 | `outlet_inn: Field(pattern=r"^\d{10}(\d{2})?$")` | seller schema | 10м |
| H29 | `file_hash: Field(pattern=r"^[a-f0-9]{64}$")` | receipt schema | 5м |
| H30 | `brand.slug: Field(pattern=r"^[a-z0-9-]+$")` | brand schema | 5м |

---

## 🟡 MEDIUM — после MVP

| # | Что | Источник |
|---|---|---|
| M1 | `AbstractRepository[T]` — избежать копипасты в 10 репозиториях | arch |
| M2 | `X-Request-ID` middleware + propagation в structlog | arch |
| M3 | structlog **везде** (сейчас mix со stdlib logging) | arch |
| M4 | PII scrubbing процессор для structlog (телефон, ФИО) | sec |
| M5 | `summary` / `description` / `tags` / `examples` / `operationId` на всех роутах — без них Swagger бесполезен для генерации клиентов фронта | api |
| M6 | `responses={404, 409, 422}` декларация на роутах | api |
| M7 | `version="1.0.0"` в `FastAPI(...)` | api |
| M8 | `POST /receipts/bulk-approve` для админа (одобрение пачкой) | api |
| M9 | `LoginRequest.id` → `LoginRequest.telegram_id` (единая нейминг-конвенция) | api |
| M10 | `InfoResponse` с `Field(discriminator='subject_type')` — иначе Swagger Union без подсказки | api |
| M11 | Чёрный список `shop_inn` — поле есть, механизма нет | fraud |
| M12 | Дневные лимиты (Redis INCR `rl:seller:{id}:receipts:{date}`) | fraud |
| M13 | Burst detection (Redis sliding window) | fraud |
| M14 | Тесты: `conftest.py` с фикстурой сессии через testcontainers, `test_ensure_seller_race`, `test_balance_invariant`, `test_payout_atomicity`, `test_review_state_machine` | arch / fraud |

---

## 📦 OCR / ФНС-интеграция — план

Полная версия → `reviews/06-ocr-plan.md`. Ключевые решения:

- **Стек:** `arq` (asyncio-native очередь, тот же event loop с FastAPI) + `httpx` + `zxing-cpp` (QR без системного libzbar) + `redis` (кеш OFD-ответов).
- **Провайдер:** для MVP — **`proverkacheka.com`** (ключ выдают сразу, через менеджера не надо). Для P1 — переключение на **OFD.ru** (товары, GPS магазина). Оба — через `OFDClientProtocol`, переключение через `settings.ofd_provider`.
- **Хранилище файлов:** MVP — Telegram `file_id` в `file_url` (ничего не поднимать). P1 — MinIO/S3.
- **Новые модули:** `src/receipt_pipeline/`, `src/receipt_ocr/`, `src/ofd_client/`, `src/sku_matcher/`, `src/bonus_engine/`, `src/fraud/`.
- **Поток:** upload → file_hash check → store → enqueue `process_receipt(id)` → QR extract → fraud check → OFD call → SKU match → bonus calc → atomic `UPDATE receipt + INSERT bonus_transaction`.
- **State machine:** `pending → ocr_in_progress → {approved | rejected | on_review | needs_revision}`.
- **Длительность MVP:** ~2-3 недели.

---

## 🎨 Фронт — план

Полная версия → `reviews/07-frontend-plan.md`. Ключевые решения:

- **Стек:** Vite + React 18 + TypeScript + Tailwind 3 + `@telegram-apps/sdk-react` + TanStack Query + Zustand + axios + framer-motion + `@use-gesture/react` + `vaul` (bottom sheet) + `@hey-api/openapi-ts` (типы из OpenAPI).
- **Структура:** feature-based (`features/seller/pages/...`, `features/admin/pages/...`) + общие `components/atoms|molecules|organisms`.
- **Темы:** CSS-переменные в `:root` + `.dark`, хук `useTmaTheme` слушает `colorScheme` от TMA. Tailwind-конфиг ссылается на `var(--color-*)`.
- **Роутинг:** react-router v6 с role-guards (`/seller/*`, `/admin/*`), bottom sheets — через Zustand-стор, не через URL.
- **Pages:** 13 экранов (9 seller, 4 admin) + 4 bottom sheets.
- **Фазы:** P0 скелет+auth (3-4д) → P1 seller-flow (5-7д) → P2 admin swipe+payouts (5-7д) → P3 polish+notifications (3-4д).

---

## ❓ Открытые вопросы — нужны решения от пользователя

| # | Вопрос | Почему важно |
|---|---|---|
| Q1 | **Получение телефона продавца** — в TMA нет нативного API запроса контакта. Варианты: (а) ввод вручную, (б) запрос через бота до открытия TMA (правильно, но нужна координация бот↔TMA), (в) опциональное поле | Блокирует RegPage |
| Q2 | **OFD-провайдер для MVP** — proverkacheka (быстрее получить ключ) или сразу OFD.ru (богаче ответ) | Сроки получения ключа |
| Q3 | **Где хранить файлы чеков** — Telegram `file_id` (бесплатно, ничего не разворачивать) или сразу MinIO (контроль, presigned URL) | Влияет на дизайн `upload` endpoint |
| Q4 | **Super-admin UI** — отдельный интерфейс или те же экраны что у admin? В прототипе и ТЗ нет упоминания | Влияет на роутинг |
| Q5 | **Где живёт фронт** — `/Users/kexibo/VLIQ-BOT/frontend/` рядом с бэком или отдельный репо `vliq-frontend`? | Влияет на git-workflow |
| Q6 | **OCR-фотомод фолбэк** — если QR не читается, делать OCR через Yandex Vision / Tinkoff (платно) или сразу `needs_revision` (ручная проверка админом) | По ТЗ MVP — `needs_revision` достаточно |

---

## 🗺️ Рекомендуемый порядок работ

**Спринт 0 (1-2 дня)** — фундамент, который нужен всем:
- B1–B8 (все BLOCKER)
- H17–H20 (lifespan, exception handlers, lru_cache settings)
- H16 (lifespan)
- Создать `.gitignore`, ротировать секреты

**Спринт 1 (3-5 дней)** — auth + базовая безопасность:
- H1–H7 (JWT, шифрование, rate limit, прод-Swagger)
- H21–H24 (upload endpoint, action endpoints, /sellers/me, разнести ReceiptCreate)
- H8–H10 (индексы)
- H12–H14 (атомарность approve/payout)

**Спринт 2 (2-3 недели)** — OCR пайплайн (см. `06-ocr-plan.md` MVP):
- Модули receipt_pipeline, receipt_ocr, ofd_client, sku_matcher, bonus_engine
- `proverkacheka.com` интеграция + fake-клиент для тестов
- arq worker
- Базовые тесты пайплайна

**Спринт 3 (параллельно с 2) — фронт P0 + P1** (см. `07-frontend-plan.md`):
- Создание Vite-проекта, Tailwind, TMA SDK
- Auth flow
- Seller-страницы (home, upload, balance, history, profile)

**Спринт 4 (1-2 недели)** — фронт P2 + бэк дозаливка:
- Admin SwipeDeck + payouts
- H25 (фильтры/пагинация), H15 (idempotency)
- M1–M14 по приоритету

**Спринт 5 — полировка:**
- P3 фронта, P2 OCR (MinIO, OFD.ru переключение, метрики)
- Tests
- Финальное ревью + security audit перед prod
