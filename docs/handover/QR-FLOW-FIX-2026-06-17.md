# QR-флоу: починка и передача в ручной тест (2026-06-17)

Ветка: **`fix/qr-flow`** (от `main` @ `49c6268`). Тестировалось на macOS + Docker/OrbStack.

---

## 1. TL;DR

QR-флоу **не работал** из-за нескольких реальных дефектов (не только несоответствий спеке). Все
починены, оба пути QR доведены до рабочего состояния и проверены end-to-end:

- **Telegram-скан** (`POST /receipts/qr-payload`) — продавец сканирует QR → чек уходит на проверку.
- **Фото с QR** (`POST /receipts/upload`) — сервер извлекает QR из фото (zxing) → чек уходит на проверку.

Оба пути теперь детерминированно доходят до статуса **«На проверке» (`on_review`)**, админ назначает
бонус и одобряет → продавец видит **«Одобрен»** и начисление. Прогон приёмки — в §6.

Бэкенд: **211 тестов зелёные** (1 предсуществующий фейл в несвязанном модуле, см. §8).
Фронтенд: typecheck/lint/14 unit-тестов/`build` — зелёные.

---

## 2. Что было сломано (корневые причины)

| # | Дефект | Симптом |
|---|--------|---------|
| 1 | **Воркер пайплайна не запускался в локальной разработке** (в `Makefile` нет цели) | Чек заливается, но навсегда висит в `pending` — «ничего не происходит» |
| 2 | **Воркер использовал `LocalFileStorage`**, хотя бэкенд пишет в S3/MinIO | `pipeline.file_not_found` → QR с фото никогда не извлекался → чек уходил в тупик |
| 3 | **Сервис `receipt-pipeline-worker` в compose не имел S3-env** (в отличие от backend) | то же: воркер читал `RECEIPT_STORAGE=local` из `.env` |
| 4 | Воркер не передавал `ocr_mode` из настроек | `OCR_MODE` игнорировался воркером |
| 5 | Пайплайн загонял чеки в `needs_revision` (нечитаемый QR, ОФД недоступен) — **тупик, админ не может одобрить** | продавец видел «Нужны правки», чек застревал |
| 6 | Пайплайн **авто-отклонял** дубли / старую дату и **авто-одобрял** happy-path | противоречило спеке (решает админ); мешало повторному тесту |
| 7 | `OCR_MODE=full` + `OFD_PROVIDER=proverkacheka` | любой тестовый чек требовал реального чека из ФНС |
| 8 | Несогласованные конверты ошибок (`/finalize`, `/qr-payload`) | у продавца общий тост вместо понятного сообщения |

---

## 3. Что изменено

### Бэкенд
- **`src/app/arq_worker.py`** — воркер теперь строит storage через `get_receipt_storage()` (совпадает
  с бэкендом) и передаёт `ocr_mode=settings.OCR_MODE`. **Чинит извлечение QR из фото.**
- **`src/receipt_pipeline/orchestrator.py`** — все аномалии (нечитаемый QR, парс-фейл, ОФД недоступен,
  дубли, старая дата) → **`on_review`** (раньше `needs_revision`/`rejected`). Happy-path → **`on_review`**
  с *предложенным* бонусом (раньше авто-`approved`); `bonus_transaction` создаётся только при одобрении
  админом. Demo-режим больше не ставит фикс. 250 (спека S8). Убран dead-end `needs_revision`.
- **`src/receipt/handlers/api/v1/router.py`** — `/qr-payload` парс-ошибка → `AppError("QR_PARSE_FAILED")`;
  `/finalize` дубль → `AppError("RECEIPT_DUPLICATE")` (единый конверт с `user_message`).
- Тесты обновлены под новое поведение (`test_thresholds.py`); `test_proverkacheka.py` приведён к коду.

### Фронтенд
- **`utils/receiptStatus.ts`** + **`pages/StatusPage.tsx`** — статусы продавца схлопнуты к **4** спековым
  (`На проверке / Одобрен / Отклонён / Выплачен`); `needs_revision` больше не показывается как «Нужны
  правки». Поллинг статуса продолжается до решения админа.
- **`pages/UploadPage.tsx`** — **оба пути QR** сохранены и работают; добавлены **множественный выбор файлов**
  (`multiple`, спека S3.2) и **клиентская предпроверка QR на фото** (`BarcodeDetector`, S3.3) с неблокирующим
  предупреждением.

### Инфраструктура
- **`Makefile`** — добавлена цель **`make worker`** (arq) — обязательна для обработки чеков в локальной разработке.
- **`docker-compose.yml`** — воркеру добавлены `RECEIPT_STORAGE=s3` + `S3_ENDPOINT_URL` (зеркало бэкенда).
- **`docker-compose.dev.yml`** (новый) — dev-оверлей: `OFD_PROVIDER=fake` + публикация порта 8000, чтобы
  QR-флоу тестировался без реальной ФНС.
- **`docs/handover/assets/`** — образцы QR (`sample-receipt-qr.png`, `sample-receipt-qr-2.png`) + фикстуры ОФД.

---

## 4. Как запустить

**Тестовый режим (рекомендуется для ручной проверки — без реальной ФНС):**
```bash
cd /Users/kexibo/VLIQ-BOT
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```
Фронтенд: http://localhost (через Caddy) • API: http://localhost:8000 • MinIO-консоль: http://localhost:9001 (minioadmin/minioadmin).

**Боевой режим (реальная ФНС):** задать в `.env` `OFD_PROVIDER=proverkacheka` + `PROVERKACHEKA_TOKEN`, затем `docker compose up -d`.

**Локальная разработка без docker:**
```bash
make up          # инфра: postgres + redis + minio
make backend     # uvicorn :8000
make worker      # arq воркер — ОБЯЗАТЕЛЬНО, иначе чеки висят в pending
make frontend    # vite :5173
```

Тестовые личности (seed): продавец `telegram_id=12345` (= `MOCK_TELEGRAM_ID` в AuthGate), админ `99998`, супер-админ `99999`.

---

## 5. Как протестировать вручную

### Через интерфейс (Telegram Mini App / браузер)
1. Открыть фронтенд как продавец (dev-личность 12345).
2. Экран «Загрузить чек» → три способа: **Камера**, **PDF / файл** (можно выбрать несколько), **QR-код**.
   - В Telegram кнопка «QR-код» открывает встроенный сканер → отсканировать `docs/handover/assets/sample-receipt-qr.png`.
   - В браузере (без Telegram) «QR-код» откроет выбор файла — приложите тот же PNG, сервер извлечёт QR.
3. «Отправить чек» → экран статуса показывает **«Чек на проверке»** (поллинг сам обновит статус).
4. Зайти админом → лента проверки → назначить бонус и **Одобрить** → продавец видит **«Одобрен»** и начисление.

### Через API (быстрая проверка)
Образец QR (совпадает с фикстурой ОФД): `t=20260610T1430&s=599.00&fn=1234567890&i=12345&fp=67890&n=1`
```bash
# токен продавца:
docker compose exec -T backend python -c "from src.app.auth.jwt import jwt_auth; from src.seller.models import Seller; print(jwt_auth.create_token(Seller(telegram_id=12345)))"
# Путь A (Telegram-скан):
curl -X POST localhost:8000/api/v1/receipts/qr-payload -H "Authorization: Bearer <TOK>" \
     -H 'Content-Type: application/json' -d '{"qr_raw":"t=20260610T1430&s=599.00&fn=1234567890&i=12345&fp=67890&n=1","brand_id":1}'
# Путь B (фото):
curl -X POST localhost:8000/api/v1/receipts/upload -H "Authorization: Bearer <TOK>" \
     -F "file=@docs/handover/assets/sample-receipt-qr.png;type=image/png" -F "brand_id=1"
# Статус:
curl localhost:8000/api/v1/receipts/<ID>/status -H "Authorization: Bearer <TOK>"
```

---

## 6. Результаты приёмки (проведена)

| Проверка | Результат |
|----------|-----------|
| Путь A — `/qr-payload` (образец QR) | `pending → on_review` (обогащён ОФД-фикстурой) ✓ |
| Путь B — `/upload` (фото с QR) | воркер прочитал из S3 → извлёк QR → ОФД → `on_review` ✓ |
| Админ: назначить бонус 250 + одобрить | чек `approved`; продавец видит `status=approved, bonus=250`; баланс обновился ✓ |
| Дубль (повтор того же QR) | `409 RECEIPT_DUPLICATE` + «Этот чек уже был загружен ранее.» + `existing_receipt_id` ✓ |
| Битый QR | `400 QR_PARSE_FAILED` + «Не удалось прочитать QR-код. Попробуй ещё раз.» ✓ |
| `needs_revision` тупик | устранён — все авто-провалы идут в `on_review` ✓ |
| Бэкенд `pytest` | **211 passed**, 1 skipped, 1 предсущ. фейл (см. §8) |
| Фронтенд | `tsc` 0 ошибок • `eslint` 0 ошибок • 14 unit зелёные • `build` ок |

---

## 7. Соответствие спеке (срез: фронтенд + QR-флоу)

| Требование | Было | Стало |
|------------|------|-------|
| S3.2 несколько фото/PDF | один файл | `multiple` + загрузка списком ✓ |
| S3.3 предпроверка QR на фото + предупреждение | нет | `BarcodeDetector`, неблокирующее предупреждение ✓ |
| Статусы продавца = 4 (нет «на доработке») | 7, был «Нужны правки» | схлопнуто к 4; `needs_revision` устранён ✓ |
| «ручной fallback» при недоступности ОФД | `needs_revision` (тупик) | `on_review` (админ решает) ✓ |
| Нет авто-бонуса/авто-одобрения (S8/A2/UC-03) | авто-`approved` + авто-бонус | `on_review` + бонус назначает админ ✓ |
| Единый конверт ошибок | `/finalize`, `/qr-payload` выбивались | единый `AppError` ✓ |
| **Оба пути QR (по вашему решению)** | скан ломался, фото не извлекалось | оба работают ✓ |

**Намеренно НЕ менялось** (вне согласованного среза, чтобы не дестабилизировать): жёсткий 409 на дубль на
ingest (нужен из-за UNIQUE-индексов в БД — иначе нужна миграция); удаление `needs_revision` из enum/стейт-машины
(оставлено недостижимым, чтобы не ломать `test_state_machine`); серверная растеризация QR из PDF (PIL не читает
PDF — QR из PDF по-прежнему уходит в `on_review` на ручную проверку).

---

## 8. Известные ограничения / предсуществующее

- **1 красный тест — предсуществующий, не связан с QR:** `tests/integration/test_business_process.py::test_step2_get_me_returns_seller` (рассинхрон мока в модуле seller). Падает и на чистом `main` (проверено стэшем). Не трогал — вне среза QR.
- QR из **PDF** не извлекается на сервере (нет растеризации) → такой чек уходит в `on_review` (ручная проверка), а не отклоняется.
- Дев-оверлей (`docker-compose.dev.yml`) использует **fake OFD** — реальные произвольные чеки не «обогащаются», но корректно доходят до `on_review`.

---

## 9. Бэкап прежнего состояния (важно)

Ваш прежний workspace расходился с `main` и имел 113 несохранённых правок. По вашему решению workspace
переведён на `main`. Всё прежнее сохранено и **восстановимо**:
- Полный бэкап: **`~/vliq-workspace-FULLBACKUP-2026-06-17.tgz`** (включая `backend/.git` и грязное дерево).
- `.env`-файлы: **`~/vliq-env-backup-2026-06-17/`** (восстановлены в новый checkout).
- Прежний backend-WIP закоммичен в ветку `feat/sprint-1-api-endpoints` (внутри бэкапа).

---

## 10. Тесты

```bash
# Бэкенд (нужны postgres + БД vliq_test):
cd backend && poetry run pytest -q
# Фронтенд:
cd frontend && npx tsc -p tsconfig.app.json --noEmit && npm run lint && npx vitest run && npm run build
```
