# План: OCR + ФНС/ОФД интеграция

> Агент: Plan (Sonnet). Сгенерировано 2026-05-24.

## 1. Контекст

Проект — чистый scaffold. Модели `Receipt`, `BonusTransaction` уже финальные — всё необходимое в БД есть. `file_hash` (UNIQUE) и `qr_raw` (UNIQUE) — готовые индексы для дубль-чека. `Promotion.rules` и `Sku.aliases` — JSONB.

## 2. Новые модули

### `src/receipt_pipeline/`
```
orchestrator.py       # ReceiptPipelineOrchestrator
steps.py              # PipelineInput, PipelineResult, StepError
state_machine.py      # ReceiptStateMachine — разрешённые переходы
```

### `src/receipt_ocr/`
```
hasher.py             # sha256_hash(bytes), phash(bytes)
storage.py            # FileStorage — Telegram file_id для MVP
qr_extractor.py       # QRExtractor.extract(image_bytes) → QRData | None
qr_parser.py          # parse_qr_string(raw) → ParsedQR (fn, fd, fp, sum, date)
ocr_fallback.py       # OCRClient (для P2)
```

### `src/ofd_client/`
```
base.py               # Protocol OFDClientProtocol
ofd_ru.py             # OFDRuClient
proverkacheka.py      # FallbackOFDClient (MVP)
schemas.py            # OFDReceipt, OFDItem
cache.py              # Redis-cache по (fn, fd, fp)
exceptions.py         # OFDNotFoundError, OFDBlockedError, OFDRateLimitError
fake.py               # FakeOFDClient для тестов (читает JSON-фикстуры)
```

### `src/sku_matcher/`
```
matcher.py            # SkuMatcher.match(item_name, skus) → MatchResult
normalizer.py         # normalize_name(s) → str
```

### `src/bonus_engine/`
```
engine.py             # calculate_bonus(items, promotions, brand_settings)
rule_interpreter.py   # interpret_rule(rule, context) → int
schemas.py            # BonusResult, RuleContext, AppliedPromotion
```

### `src/fraud/`
```
checks.py             # FraudChecker
signals.py            # FraudSignal dataclass
```

## 3. Зависимости

```toml
zxing-cpp = "^2.2"           # QR — без системного libzbar
Pillow = "^10.4"             # открыть изображение
python-multipart = "^0.0.9"  # multipart upload
arq = "^0.26"                # asyncio queue
httpx = "^0.27"              # async HTTP для OFD
redis = {extras=["hiredis"], version="^5.0"}
imagehash = "^4.3"           # pHash (MVP+)
respx = "^0.21"              # мок httpx в тестах
```

**Почему arq, а не Celery:** asyncio-native, тот же event loop с FastAPI + asyncpg. Celery требует gevent или отдельные процессы.

**Почему zxing-cpp, а не pyzbar:** wheel с батарейками, не требует libzbar в Linux Docker.

**Почему Telegram file_id, а не S3:** MVP — ничего поднимать не надо. Минус — нет прямой ссылки. Для P1 — MinIO.

## 4. Поток данных

```
TMA (POST /api/v1/receipts/upload, multipart: file + brand_id)
  → handler:
    1. sha256(file_bytes) → file_hash
    2. SELECT receipt WHERE file_hash=? → если дубль → 409 + fraud_signal
    3. Сохранить file → Telegram/MinIO → file_url
    4. INSERT receipt(status=pending, file_hash, file_url) → receipt_id
    5. arq.enqueue process_receipt(receipt_id)
    6. Return 202 {receipt_id, status: pending}

arq Worker: process_receipt(receipt_id)
  Шаг 1: UPDATE status=ocr_in_progress
  Шаг 2: QRExtractor.extract(image_bytes)
    ├── OK → parse_qr_string → fn, fd, fp, sum, date
    └── None → OCRFallback (P2) или → status=needs_revision, STOP
  Шаг 3: FraudChecker
    ├── check qr_raw → дубль → status=rejected + fraud_signal
    └── check fn+fd+fp → дубль → status=rejected + fraud_signal
  Шаг 4: OFDRuClient.get_receipt(fn, fd, fp, sum, date)
    ├── cache hit → пропустить HTTP
    ├── OFDNotFoundError → status=rejected, reason="ФНС не нашла"
    ├── OFDBlockedError → enqueue retry в 24ч, status=on_review
    └── OK → ofd_receipt (items, shop, GPS)
  Шаг 5: Верификация (total_sum ±1% + purchase_date) QR vs OFD
    └── несовпадение → status=on_review + fraud_signal
  Шаг 6: SkuMatcher.match(ofd_items, sku_catalog)
    └── ≥1 сматчена — продолжать; 0 — status=on_review
  Шаг 7: BonusEngine.calculate_bonus → BonusResult
  Шаг 8: Atomic transaction
    ├── UPDATE receipt: status=approved, items, bonus_amount, fn/fd/fp, qr_raw, ocr_raw
    └── INSERT bonus_transaction: kind=accrual_receipt, source_id=receipt_id
```

## 5. API-эндпоинты

### `POST /api/v1/receipts/upload`
```
Request: multipart/form-data
  file: UploadFile (image/jpeg | image/png | application/pdf)
  brand_id: int

Response 202:
  { "receipt_id": 1234, "status": "pending" }

Response 409 (дубль file_hash):
  { "detail": "duplicate_receipt", "existing_receipt_id": 999 }
```

### `GET /api/v1/receipts/{receipt_id}`
Реализовать — полный `ReceiptRead`.

### `GET /api/v1/receipts/{receipt_id}/status`
Лёгкий polling для TMA — только `{receipt_id, status, bonus_amount}`.

### `POST /api/v1/receipts/{receipt_id}/retry`
Модератор — повторная постановка из `on_review`/`needs_revision`.

## 6. State machine

```
pending
  → ocr_in_progress     (system)

ocr_in_progress
  → needs_revision      (system: QR не читается)
  → on_review           (system: реквизиты есть, OFD заблок / SKU не сматчен / расхождение)
  → rejected            (system: дубль / ФНС не нашла)
  → approved            (system: ок)

needs_revision
  → ocr_in_progress     (system: retry по запросу модератора)
  → rejected            (admin)

on_review
  → approved            (admin)
  → rejected            (admin)
  → ocr_in_progress     (system: retry OFD после снятия блока)

approved
  → paid_out            (system: выплата прошла)
  → rejected            (admin: отмена с reason)
```

## 7. OFD.ru — детали

**Запрос:**
```
POST https://ofd.ru/api/partner/v3/receipts/GetReceipt
Authorization: tokenSecret <UUID>
Content-Type: application/json

{
  "FnNumber": "...",
  "DocNumber": "...",       # fd
  "DocFiscalSign": "...",   # fp
  "DocDateTime": "2026-05-15T14:30:00",
  "TotalSum": 12345,        # копейки
  "ReceiptOperationType": 1
}
```

**Кеш:** ключ `ofd:{fn}:{fd}:{fp}`, TTL 24h. Два продавца грузят один чек — второй получит cache hit.

**Ретраи:**
- HTTP 429 → exponential backoff 2/4/8с, 3 попытки
- `OFDBlockedError` (4+ ошибок по одному чеку) → `status=on_review`, retry через 25ч (arq `defer_by`)
- Timeout 5с

**Dev-mode:** в `settings.env == local` OFD-клиент подменяется `FakeOFDClient`, читает `tests/fixtures/ofd_responses/{fn}_{fd}_{fp}.json`.

**Ключ:** для MVP — `proverkacheka.com` (выдают сразу). Переключение через `settings.ofd_provider`.

## 8. Антифрод — порядок

1. `file_hash` SELECT (до сохранения файла, <1мс)
2. После QR: `qr_raw` SELECT
3. `fn + fd + fp` composite SELECT (нет UNIQUE — **добавить в миграции**)
4. `purchase_date < now() - 30 days` → reject (настраивается в `brand.settings`)
5. `fn+fd+fp` от другого `seller_id` → fraud_signal `cross_seller_duplicate`

Сигналы пишутся в `receipt.fraud_signals` JSONB при любом исходе — для аудита.

## 9. Бонусный движок

`Promotion.rules` JSONB — массив правил:
```json
{ "type": "per_unit", "sku_ids": [1,2,3], "bonus_per_unit": 50, "max_units": 10 }
{ "type": "percent_of_total", "min_total": 50000, "percent": 5, "max_bonus": 1000 }
```

`BonusEngine.calculate_bonus()` — итерация по active promotions (sort priority DESC), применяет правила, возвращает `BonusResult(total_amount, breakdown_per_promo)`. Первое сработавшее с `stackable=false` прерывает цепочку.

Транзакционность: `UPDATE receipt + INSERT bonus_transaction` в одном `async with session.begin()`.

## 10. Метрики/логи

Structured events:
- `receipt.upload` — file_size, file_kind, seller_id, brand_id
- `receipt.qr_extracted` — success, duration_ms
- `receipt.ofd_request` — provider, fn, cached, status_code, duration_ms
- `receipt.sku_match` — matched_count, total, unmatched_names
- `receipt.approved` / `receipt.rejected` — bonus_amount, promotion_id, reason
- `receipt.fraud_detected` — signal, severity

Декоратор `@log_step(name="ofd_request")` на каждом шаге. Prometheus (P1): `receipt_processing_duration_seconds{step}`, `receipt_status_total{status}`.

## 11. Тестируемость

Моки:
- `OFDClientProtocol` → `FakeOFDClient(responses)` через DI
- `FileStorage` → `InMemoryFileStorage`
- `QRExtractor` → `FakeQRExtractor(result)`
- arq enqueue → `FakeArqQueue` (список задач)
- HTTP к OFD → `respx.mock`

Фикстуры:
- `tests/fixtures/images/valid_qr.jpg`
- `tests/fixtures/images/no_qr.jpg`
- `tests/fixtures/ofd_responses/*.json`
- `conftest.py` — `db_session` с rollback после каждого теста (savepoint)

## 12. Roadmap

### MVP (2-3 недели)
1. `receipt_ocr/hasher.py` + `storage.py` (Telegram file_id)
2. `receipt_ocr/qr_extractor.py` (zxing-cpp) + `qr_parser.py`
3. `fraud/checks.py` — file_hash + qr_raw + fn/fd/fp дубли
4. `ofd_client/proverkacheka.py` + `fake.py`
5. `sku_matcher/matcher.py` — exact/fuzzy match по aliases
6. `bonus_engine/engine.py` — `per_unit` правило
7. `receipt_pipeline/orchestrator.py` + `state_machine.py`
8. `POST /receipts/upload` + `GET /receipts/{id}/status`
9. arq Worker: `process_receipt` task
10. Миграция: `UniqueConstraint(fn, fd, fp)`
11. `FakeOFDClient` + базовые тесты

### P1 (1-2 недели после MVP)
- Переключение на OFD.ru
- Redis-кеш OFD-ответов
- MinIO вместо Telegram file_id
- `percent_of_total` и stackable правила
- `POST /receipts/{id}/retry`
- `PATCH /receipts/{id}` с state machine
- pHash для нечётких дублей
- `GET /receipts` с фильтрами и пагинацией

### P2 (hardening)
- OCR fallback (Yandex Vision) для нечитаемых QR
- Prometheus метрики (`/metrics`)
- OFD retry scheduler (`defer_by`)
- Admin уведомления при `on_review`
- Rate limiting per seller (Redis)
- Budget tracking промоакций
