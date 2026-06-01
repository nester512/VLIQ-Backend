# Ревью 5: API-контракты, REST, OpenAPI

> Агент: API-дизайнер (Sonnet). Сгенерировано 2026-05-24.

## Таблица эндпоинтов

Префикс: `/api/v1` (из `Settings.PATH_PREFIX`). **Реализовано: 3 из 54.**

| METHOD | PATH | response_model | status |
|--------|------|----------------|--------|
| POST | /auth/login | LoginResponse | **impl** |
| GET | /auth/info | InfoResponse (Union) | **impl** |
| POST | /sellers/tg-upsert | SellerRead | **impl** |
| POST | /sellers | SellerRead | 501 |
| GET | /sellers | list[SellerRead] | 501 |
| GET | /sellers/{telegram_id} | SellerRead | 501 |
| PATCH | /sellers/{telegram_id} | SellerRead | 501 |
| DELETE | /sellers/{telegram_id} | — | 501 |
| (аналогично для brands, admins, skus, promotions, receipts, bonus-transactions, payout-requests, notifications, audit-logs — все 501) | | | |

## Несоответствия REST

**2.1 `POST /sellers/tg-upsert` — action verb в URL** (`router.py:12`). Для TMA-сценария оправдано, но лучше `POST /sellers/me` с initData в теле.

**2.2 `POST /sellers` vs `POST /sellers/tg-upsert` — дублирование** (`router.py:32`). После реализации они будут конкурировать. Разграничить: один — публичный для TMA, другой — защищённый admin-create.

**2.3 `DELETE /audit-logs/{id}` и `PATCH /audit-logs/{id}`** — audit log append-only, нарушение семантики. DELETE и PATCH для audit_log и bonus_transaction убрать или вернуть 405.

**2.4 `PATCH /bonus-transactions/{id}` мутирует append-only ledger** (`bonus_transaction/schemas/api.py:22`). `BonusTransactionUpdate` содержит только `reason` "for API symmetry only" — вводит фронт в заблуждение.

**2.5 Нет 409 для конфликтов.** `ReceiptCreate` содержит `file_hash` (уникальный). При повторной отправке нет планируемого 409 Conflict.

**2.6 `GET /sellers/{telegram_id}` — int без `ge=1`** (`router.py:43`). Принимает любой int, включая отрицательные.

**2.7 Нет `/health` под `/api/v1`** — есть только вне префикса.

## Pydantic-схемы

**3.1 Паттерн `XxxCreate/Update/Read` консистентный** во всех 11 модулях. `ConfigDict(from_attributes=True)` присутствует. Плюс.

**3.2 `ReceiptCreate` содержит бизнес-поля, которые не должен задавать клиент** (`receipt/schemas/api.py:26-47`). Клиент (TMA) передаёт `file_hash`, `ocr_raw`, `ocr_confidence`, `fraud_signals`, `items` — эти поля генерирует OCR-пайплайн. Разделить:
- `ReceiptUploadRequest` (только `file_kind` + multipart file)
- `ReceiptOcrResult` (внутренняя схема для воркера)

**3.3 `ReceiptCreate.status` — клиент может установить любой статус** (`api.py:29`). Нужна валидация: при создании статус всегда `pending`.

**3.4 `PayoutRequestCreate` — клиент задаёт `status`** (`api.py:18`) — аналогичная проблема.

**3.5 `NotificationCreate` содержит `sent_at`, `read_at`, `delivery_status`** — внутренние поля пайплайна отправки в Create-схеме.

**3.6 Отсутствует валидация форматов:** `phone_e164` без `pattern`, `brand.slug` без `pattern`, `sku.code` без паттерна, `receipt.fn/fd/fp` без числовой валидации, `outlet_inn` без проверки длины.

**3.7 Enum-сериализация:** Pydantic v2 сериализует Enum как строку — ок, если SQLAlchemy использует `Enum(..., values_callable=lambda x: [e.value for e in x])`.

**3.8 `LoginRequest.id` vs `telegram_id` в других схемах** — единая конвенция.

**3.9 `InfoResponse` как `Union` без дискриминатора** (`auth/schemas/api.py:29`). Swagger покажет `anyOf` без подсказки. Добавить `Annotated[Union[...], Field(discriminator='subject_type')]`.

## OpenAPI-качество

**4.1** `summary`/`description`/`tags` почти нигде нет. Только `POST /sellers/tg-upsert` имеет `summary`. Swagger бесполезен как контракт.

**4.2** `tags` PascalCase в единственном числе (`tags=["Seller"]`). Лучше `"Sellers"`, `"Payout Requests"`.

**4.3** Нет `examples` ни в одном поле / роуте. В Swagger нет pre-filled тела — нельзя "Try it out".

**4.4** DELETE возвращает 204 без тела — правильно.

**4.5** Нет документирования 4xx-ответов. `responses={404, 409, 422}` отсутствует.

**4.6** `version="0.1.0"` дефолт — нужно явно указать.

**4.7** `operationId` не кастомизирован. FastAPI генерирует `create_seller_sellers_post`. Для генерации клиента (openapi-ts) нужно явно: `operation_id="createSeller"`.

**4.8** Авторизация не задокументирована на большинстве роутов. `validate_token_dependency` импортирован только в `auth/router.py`.

## TODO: эндпоинты, которые надо добавить

**Критичные (P0):**

1. `POST /receipts/upload` — multipart: `file` + `brand_id`. Возвращает `ReceiptRead` со `status=pending`. Запускает OCR-воркер асинхронно.
2. `POST /receipts/{id}/approve|reject|revise` — action-эндпоинты с проверкой state machine.
3. `POST /auth/tma-login` — верификация `initData` HMAC-SHA256.
4. `GET /sellers/me` — текущий продавец по JWT.
5. `GET /sellers/me/balance` — агрегированный баланс.

**Высокие (P1):**

6. `POST /payout-requests` с `Idempotency-Key` header.
7. `POST /receipts/bulk-approve` для админа.
8. `GET /sellers/me/receipts` — история чеков.
9. `GET /sellers/me/notifications`.
10. `POST /notifications/{id}/read`.

**Средние (P2):**

11. `POST /webhook/telegram` — Telegram Bot API webhook.
12. `GET /analytics/dashboard` (admin).
13. `GET /receipts` с фильтрами и cursor-pagination.
14. `GET /sellers` с фильтром и пагинацией.
15. `POST /sellers/{telegram_id}/block` (admin).

**Низкие (P3):**

16. `GET /audit-logs` с фильтрами.
17. `GET /promotions/{id}/stats`.
18. `POST /auth/refresh`.
