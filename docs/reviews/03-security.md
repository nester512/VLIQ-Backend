# Ревью 3: Безопасность

> Агент: security-инженер (Sonnet). Сгенерировано 2026-05-24.

## CRITICAL (немедленно фиксить)

**C1. `/sellers/tg-upsert` — открытый endpoint без auth** — `src/seller/handlers/api/v1/router.py:12-29`. Любой знающий API может создать seller с произвольным `telegram_id` и `brand_id`. Если `ensure_seller` обновляет `phone_e164` существующего seller (строка 73-75), атакующий может изменить контактные данные чужого аккаунта, перенаправив выплаты.

**C2. `/auth/login` — аутентификация только по `telegram_id` без Telegram initData HMAC** — `src/auth/handlers/api/v1/router.py:37-65` и `src/auth/schemas/api.py:12-13`. `LoginRequest` принимает только `{ id: int }`. Никакой проверки подписи Telegram WebApp нет. Любой знает `telegram_id` любого пользователя (это публичная информация). Атакующий вводит чужой `id` и получает JWT с ролью admin/seller.

**C3. Отсутствует `.gitignore` — `.env` с секретами попадёт в git** — файл `.gitignore` не существует. `.env` с `POSTGRES__POSTGRES_URL` и `JWT_SECRET_SALT` будет закоммичен.

**C4. CORS: `allow_origins=["*"]` + `allow_credentials=True`** — `src/app/main.py:11-17`. Запрещённая комбинация по спецификации CORS. Если в проде заменят `*` на конкретный домен, забыв убрать `allow_credentials=True`, куки/токены сессии будут отправляться с любого разрешённого сайта — CSRF-вектор. `allow_methods=["*"]` открывает DELETE/PATCH без ограничений.

## HIGH

**H1. JWT выдаётся навсегда — нет refresh/revocation** — `src/app/auth/jwt.py:37`. `lifetime=timedelta(days=6)`, refresh token отсутствует, blacklist отсутствует. Скомпрометированный токен невозможно инвалидировать 6 дней. Критично при финансовых операциях.

**H2. `payout_encrypted` — только название поля, шифрования нет** — `src/seller/models.py:80`. Никакого Fernet/AES в codebase нет. Реквизиты хранятся в открытом виде. Ключ шифрования не определён в `Settings`.

**H3. `JWT_SECRET_SALT` имеет дефолт в коде** — `src/app/settings.py:24`. Если `.env` не заполнен, сервис стартует с предсказуемым ключом.

**H4. `SellerRead` возвращает `payout_encrypted` клиенту** — `src/seller/schemas/api.py:81`. При реализации шифрования зашифрованные (или открытые) реквизиты будут утекать в API-ответ.

**H5. Отсутствует rate limiting** — `slowapi`, `limits`, `redis` отсутствуют. `/sellers/tg-upsert` и `/auth/login` доступны для неограниченного брутфорса/спама.

## MEDIUM

**M1. Валидация phone_e164 — max_length без regex** — `src/seller/schemas/api.py:16`. Принимает `"not-a-phone"`. Нужен `pattern=r"^\+[1-9]\d{7,14}$"`.

**M2. INN — нет валидации формата** — `src/seller/schemas/api.py:32`. ИНН 10/12 цифр не проверяется ни regex, ни контрольной суммой.

**M3. `file_hash` — max_length=128, но нет проверки формата sha256** — `src/receipt/schemas/api.py:34`. Без `pattern=r"^[a-f0-9]{64}$"` можно передать произвольную строку.

**M4. Swagger UI открыт в проде** — `src/app/main.py:32`. `docs_url="/swagger"` без ограничения по окружению. В `ENV=prod` нужно `docs_url=None`.

**M5. Логирование не маскирует PII** — `src/seller/repository.py:52`. `logger.info("seller_created telegram_id=%s", telegram_id)` — telegram_id логируется. Нет structlog-процессора для scrubbing phone/ФИО. Использован `logging` (не structlog).

**M6. `python-jose` — устаревшая зависимость** — `pyproject.toml`. CVE-2024-33663 algorithm confusion. Рекомендуется `PyJWT>=2.8` с явным `algorithms=["HS256"]`.

## Чек-лист «прежде чем выкатить prod»

1. Добавить `.gitignore` с `.env`, `*.pyc`, `__pycache__/`.
2. Реализовать проверку Telegram initData HMAC в `/auth/login` (HMAC-SHA-256 от строки `key=HMAC("WebAppData", bot_token)`).
3. Добавить `Depends(validate_token_dependency)` к `/sellers/tg-upsert` — вызов только от авторизованного Telegram пользователя, проверять что `token["user_id"] == body.id`.
4. Убрать `allow_origins=["*"]`, заменить на конкретный список доменов из конфига. Отключить `allow_credentials` или использовать явно.
5. Реализовать реальное шифрование `payout_encrypted` (Fernet или AES-256-GCM), добавить `PAYOUT_ENCRYPTION_KEY` в `Settings`, исключить поле из `SellerRead`.
6. Добавить `JWT_SECRET_SALT` без дефолта: упасть при старте без конфига.
7. Добавить `slowapi` + Redis rate limiting: `/auth/login` — 10 req/min per IP, `/sellers/tg-upsert` — 5 req/min per IP.
8. Добавить regex-валидацию `phone_e164`, `outlet_inn`, `file_hash` в Pydantic schemas.
9. В `ENV=prod` отключить Swagger: `docs_url=None if config.env == Env.prod else "/swagger"`.
10. Заменить `python-jose` на `PyJWT>=2.8`.
11. Добавить structlog-процессор для masking PII (phone, ФИО) перед выводом в логи.
12. Настроить secrets management (k8s Secret / AWS SSM) — убрать секреты из `.env` файла в prod-деплое.
