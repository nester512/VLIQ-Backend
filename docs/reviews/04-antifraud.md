# Ревью 4: Бизнес-корректность, Ledger, Антифрод, Race Conditions

> Агент: fintech-инженер (Sonnet). Сгенерировано 2026-05-24.

## Критические дыры антифрода

**1. Нет UNIQUE(fn+fd+fp) — главная дыра дублей.** В `receipt.models.py` поля `fn`, `fd`, `fp` есть, но составного UNIQUE-индекса по `(fn, fd, fp)` нет. Один чек можно загрузить неограниченное число раз от разных пользователей, меняя только фото. `qr_raw` UNIQUE есть, но QR можно обрезать/пережать. Без `UNIQUE(fn, fd, fp)` фискальный идентификатор не защищён.

**2. UNIQUE-поля допускают NULL — обход защиты.** `qr_raw` и `file_hash` UNIQUE, но PostgreSQL не считает два NULL нарушением. Если OCR не распознал QR (qr_raw=NULL) — можно загрузить один и тот же чек бесконечно. Решение: либо проверка на NOT NULL перед сохранением, либо partial UNIQUE index `WHERE qr_raw IS NOT NULL`.

**3. Soft-delete + UNIQUE = антифрод-баг или UX-баг (неоднозначность).** `is_deleted=True` не освобождает UNIQUE(qr_raw) и UNIQUE(file_hash). Правильно с точки зрения антифрода, но плохо для UX: продавец получил `rejected`, попытался загрузить исправленный файл того же чека — получит 500/409 по file_hash. **Предложение:** при `rejected`/`needs_revision` хранить запись с флагом `superseded_by_id`, soft-delete оставить только для fraud-аннулирования.

**4. Нет чёрного списка торговых точек (shop_inn).** Поле есть в Receipt, но механизма блокировки ИНН-мошенников нет. Сигналы мошенничества только в JSONB `fraud_signals` — это данные, не ограничение.

**5. Нет лимитов в день в схеме и коде.** `promotion` имеет `per_user_per_day`/`per_user_total`, но общесистемного лимита «N чеков/день» и «X бонусов/день» на продавца нет.

## Race Conditions / Транзакционность

**ensure_seller (repository.py:28)** — паттерн работоспособен, но небезупречен. Check-then-act: SELECT → INSERT → IntegrityError → SELECT. Между первым SELECT и INSERT возможен дубль из другого воркера. IntegrityError отлавливается корректно, повторный SELECT возвращает уже созданную запись.

**Однако** если IntegrityError произошёл по `phone_e164` (не по `telegram_id`), второй SELECT по `telegram_id` вернёт `None` и метод упадёт с `raise`. Это скрытый баг: другой пользователь с тем же номером телефона вызовет необработанное исключение вместо 409. Нужно явно проверять причину IntegrityError и возвращать `409 Phone already registered`.

**Approve receipt → bonus: атомарность отсутствует.** Нет ни сервисного слоя, ни видимого кода, который в одной транзакции делает `receipt.status = approved` + `INSERT INTO bonus_transaction`. При сбое между двумя операциями возможен чек со статусом `approved` без начисления или дубль начисления при ретрае.

**Payout flow: нет атомарности hold→completed/reverted.** Создание `PayoutRequest` должно одновременно вставлять `BonusTransaction(kind=payout_hold, amount=-N)`. Переход `paid`/`rejected` должен вставлять `payout_completed`/`payout_reverted`. Сейчас это разрозненные операции — ни FK между `payout_request.id` и `bonus_transaction.source_id`, ни транзакционная обёртка не гарантированы.

## Дизайн-предложения

**Доступный баланс (формула из ledger):**
```sql
available = SUM(amount) FILTER (WHERE kind IN (
    'accrual_receipt','accrual_promo','accrual_manual',
    'payout_reverted','correction'
)) + SUM(amount) FILTER (WHERE kind = 'payout_hold')
-- payout_hold уже отрицательный, payout_completed не учитывается (уже закрыт hold)
```
Инвариант: `SUM(amount) WHERE seller_id=X` никогда не должен уйти в минус. Проверять перед INSERT `payout_hold`.

**Rate limits / burst detection:**
- Лимиты в день: Redis INCR с TTL до конца суток (UTC). Ключ `rl:seller:{id}:receipts:{date}`. Дёшево, атомарно.
- Burst detection: Redis sliding window через `ZRANGEBYSCORE` по timestamp. Порог — конфигурация в `brand.settings` JSONB.
- Unusual amount: при `total_sum > brand.settings.suspicious_amount_threshold` — автоматически `on_review` вместо `approved`, добавлять сигнал в `fraud_signals`.

**Транзакционная схема approve → bonus:**
```python
async with session.begin():
    receipt = await session.get(Receipt, receipt_id, with_for_update=True)
    assert receipt.status == ReceiptStatus.pending  # идемпотентность
    receipt.status = ReceiptStatus.approved
    session.add(BonusTransaction(
        seller_id=receipt.seller_id,
        brand_id=receipt.brand_id,
        amount=receipt.bonus_amount,
        kind=BonusTransactionKind.accrual_receipt,
        source_type="receipt",
        source_id=receipt.id,
    ))
    session.add(AuditLog(action="approve_receipt", ...))
```
`SELECT ... FOR UPDATE` на Receipt — защита от двойного approve при параллельных запросах.

**Payout flow:**
```
CREATE PayoutRequest + INSERT payout_hold  → одна транзакция
PATCH status=paid   + INSERT payout_completed → одна транзакция
PATCH status=rejected + INSERT payout_reverted → одна транзакция
```

## Бизнес-инварианты для тестов

1. `SUM(bonus_transaction.amount) WHERE seller_id=X` >= 0 в любой момент после commit.
2. Для каждого `payout_request` со статусом `new`/`in_progress` существует ровно один `bonus_transaction(kind=payout_hold, source_id=payout_request.id)`.
3. Для каждого `payout_request(status=paid)` существует `payout_completed`.
4. `receipt.status=approved` всегда сопровождается ровно одним `bonus_transaction(kind=accrual_receipt, source_id=receipt.id)`.
5. Нет двух `Receipt` с одинаковым ненулевым `qr_raw`, ненулевым `file_hash`, или комбинацией `(fn, fd, fp)` при `fn IS NOT NULL`.
6. `ensure_seller` с `phone_e164`, уже привязанным к другому `telegram_id`, возвращает 409, а не 500.
