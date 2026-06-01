# Ревью 2: БД-модели, индексы, миграции

> Агент: senior database engineer (Sonnet). Сгенерировано 2026-05-24.

## Сводная таблица соответствия моделей ERD

| Таблица | Статус | Отклонения |
|---|---|---|
| BRANDS | OK | — |
| SELLERS | OK | — |
| ADMINS | OK | — |
| SKUS | OK | — |
| PROMOTIONS | OK | — |
| **RECEIPTS** | **Отклонение** | Отсутствует composite UNIQUE (fn+fd+fp); `qr_raw` UNIQUE не partial |
| BONUS_TRANSACTIONS | OK | — |
| PAYOUT_REQUESTS | OK | — |
| NOTIFICATIONS | Незначительно | `delivery_status` — ERD не указывает значения, модель добавляет `queued/sent/delivered/failed` — приемлемо |
| AUDIT_LOG | OK | — |

## КРИТИЧНО

**[КРИТИЧНО-1] Отсутствует composite UNIQUE INDEX на `(fn, fd, fp)`** — `src/receipt/models.py`. Без него можно залить два чека с одинаковыми `fn/fd/fp` при разных `qr_raw`. ERD требует это как ключ антидублирования фискальных реквизитов.

**[КРИТИЧНО-2] `qr_raw UNIQUE` не partial — блокирует soft-delete** — `src/receipt/models.py:87`. После soft-delete продавец не сможет повторно загрузить тот же чек. Нужно `UniqueConstraint(..., postgresql_where="is_deleted = false")` для `qr_raw` и `file_hash`.

**[КРИТИЧНО-3] `Seller` не наследует `TimeStampedModel`** — `src/seller/models.py:84-89`. `Seller(BaseModel)` — наследует голый `BaseModel`. `telegram_id` как PK — правильно, но `created_at/updated_at` объявлены вручную, что создаёт расхождение и риск рассинхронизации.

**[КРИТИЧНО-4] `env.py` — отсутствует `compare_type=True`** — `migrations/alembic/env.py:56-64`. Без него Alembic autogenerate не обнаруживает изменения типа колонки. Критично для enum: добавление нового значения в enum в проде потребует ручного `ALTER TYPE ... ADD VALUE`, и Alembic этого не увидит.

**[КРИТИЧНО-5] Нет ни одной версии миграции** — `migrations/alembic/versions/` директория не существует. БД вообще не может быть создана через Alembic. Нужно сгенерировать initial с `op.execute("CREATE SCHEMA IF NOT EXISTS vliq")` в начале `upgrade()`.

## Индексы — что добавить

| Индекс | Обоснование |
|---|---|
| `UNIQUE (fn, fd, fp) WHERE fn IS NOT NULL AND is_deleted = false` | Антифрод: core ключ дедупликации фискальных реквизитов. Partial — т.к. fn/fd/fp nullable. |
| `UNIQUE (qr_raw) WHERE is_deleted = false` | Заменить текущий глобальный UNIQUE. Иначе soft-delete блокирует повторную загрузку. |
| `UNIQUE (file_hash) WHERE is_deleted = false` | Аналогично. |
| `INDEX (brand_id, status, created_at)` на `receipt` | Hot-path: список чеков бренда по статусу с сортировкой — основной запрос админки. |
| `INDEX (seller_id, brand_id, created_at)` на `bonus_transaction` | Hot-path: баланс продавца, история транзакций. |
| `INDEX (brand_id, status)` на `seller` | Фильтр продавцов бренда по статусу. |
| `INDEX (brand_id, status)` на `promotion` | Поиск активных акций бренда при обработке чека. |
| `GIN INDEX` на `receipt.items` | OCR-матчинг: `WHERE items @> '[{"matched_sku_id": N}]'` без GIN — seqscan. |
| `GIN INDEX` на `receipt.fraud_signals` | Запросы по типу сигнала. |
| `GIN INDEX` на `sku.aliases` | OCR-матчинг по псевдонимам — частый запрос. |
| `INDEX (seller_id, status)` на `payout_request` | Получение активных заявок продавца. |
| `INDEX (actor_id, actor_type, created_at)` на `audit_log` | Лог действий конкретного актора. |
| `INDEX (entity_type, entity_id)` на `audit_log` | Лог для конкретной сущности. |

## Enum-паттерн

`SAEnum(..., values_callable=lambda x: [e.value for e in x], schema=DEFAULT_SCHEMA)` — корректен: в БД хранятся строковые значения, не имена Python-членов. Совместим с Alembic autogenerate.

**Проблема:** добавление нового значения в существующий enum в проде требует `ALTER TYPE ... ADD VALUE` (нельзя сделать в транзакции до PostgreSQL 12). В Alembic — вручную через `execute("ALTER TYPE ...")`. Autogenerate этого не поддерживает.

## Миграции — статус

| Аспект | Статус |
|---|---|
| `target_metadata` | OK (строка 31) |
| `compare_type=True` | **Отсутствует** в обоих `configure()` вызовах |
| `include_schemas=True` | OK |
| `include_object` фильтр по схеме | OK |
| Async support | OK (`async_engine_from_config`, `run_sync`) |
| Versions | **Нет ни одного файла** |
| `CREATE SCHEMA vliq` | Не предусмотрено |

**Минимум для запуска:**
1. Добавить `compare_type=True` в оба `context.configure()`.
2. Создать `migrations/alembic/versions/`.
3. Сгенерировать initial migration, добавить `op.execute("CREATE SCHEMA IF NOT EXISTS vliq")` в начало `upgrade()`.

## Базовая модель — итог

`BaseModel` (DeclarativeBase + AsyncAttrs) → `IDModel` (+ `id: intpk` BigInteger autoincrement) → `TimeStampedModel` (+ `created_at`, `updated_at` с timezone). Паттерн чистый. `Seller` и `Admin` используют `telegram_id` как PK — осознанный выбор. `BonusTransaction` и `Notification` наследуют `IDModel` (без `updated_at`) — соответствует ERD (иммутабельные записи).
