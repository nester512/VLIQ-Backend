# Приём чека по QR и «Путь чека» — техническое описание

Бизнес-описание: `docs/use-cases/01-seller.md` (UC-S4), `02-admin.md` (UC-A4), `04-system.md` (UC-SYS1–2).
Здесь — то, что нужно разработчику. Состояние на 2026-10-09, реализовано.

## Приём
- `POST /receipts/qr` (продавец, не заблокирован, 20/мин) → 202 `{receipt_id, warnings[]}`.
  Тело: `fn, fd, fp, t, s, n, source, idempotency_key, brand_id, qr_raw?`.
- Валидация — `receipt_intake/fiscal.py`, зеркало на фронте `features/seller/qr/fiscalQr.ts` (общие
  коды ошибок `QR_*`, 422 с `extra.field`).
- `source`: `telegram_scan | camera_scan | image_decode | pdf_decode | manual`; у старых файловых
  чеков `NULL`, `verification_status = not_required`.
- Идемпотентность: `(seller_id, upload_idempotency_key)`.
- Дубль ФН+ФД+ФП (только среди `source IS NOT NULL`, не удалённых) → предупреждение
  `POSSIBLE_DUPLICATE` и сигнал, не отказ.
- Воркер `process_qr_receipt_task`: сигналы риска → `on_review` → первый раунд проверки. Если задачу
  не поставить — сразу `on_review` с сигналом `pipeline_enqueue_failed`.
- Файловые эндпоинты (`/receipts/upload`, `/upload-urls`, `/finalize`) оставлены для старых клиентов;
  фронт их не вызывает. `/receipts/qr-payload` → 400 `QR_ONLY_DEPRECATED`.
- Распознавание QR из фото/PDF — только на телефоне: `zxing-wasm` + `pdf.js` (`qr/decode.ts`).

## Проверка у источников
- Справочник `check_provider` (`code, title, role, priority, enabled, disabled_until,
  consecutive_failures`). Адаптеры — `receipt_verification/providers.py`.
  Реально есть: `proverkacheka` (нужен `PROVERKACHEKA_TOKEN`), `fake` (только `CHECK_PROVIDER_STUB=true`,
  стенд). `fns`, `platformaofd`, `taxcom` — записи без адаптера, `available=false`.
- Раунд (`receipt_verification/service.py::run_round`): подключённые и включённые источники по
  `priority` до первого `ok`; метод чередуется по номеру раунда (`fields`, `qrraw`, `fields_seconds`);
  аренда чека на 10 мин против параллельных раундов.
- Расписание по ответам о чеке (`not_found`, `invalid`): 5 мин, 15 мин, 1 ч, 3 ч, 6 ч, 12 ч, 24 ч,
  48 ч → `failed` + `check_exhausted`.
- Сбои источника (`rate_limited`, `blocked`, `error`) бюджет не тратят: пауза `PROVIDER_PAUSES`
  1→3→6→12→24 ч; 5 сбоев подряд — источник пропускается 15 мин (`provider_skipped`).
- Нет ни одного источника — один `check_round_failed` (`no_provider_available`), дальше тихие
  переносы (≈2× прошедшего, 1–24 ч).
- Cron `retry_verifications_cron` — каждые 5 мин, до 25 чеков, только `status = on_review`.
- Админ: `POST /receipts/{id}/verify` `{provider?}` (409 `CHECK_PROVIDER_UNAVAILABLE`,
  `RECEIPT_NOT_VERIFIABLE`, `VERIFICATION_IN_PROGRESS`). Неуспешная ручная проверка не снимает
  `verified`.
- Проверка не трогает `status` и `bonus_amount`. При `ok` заполняет пустые `shop_name`, `shop_inn`,
  `items`; расхождение суммы > 1% → сигнал `qr_ofd_mismatch`.

## Хранение
- `receipt_verification_attempt` — каждый вызов источника: запрос (без токена), сырой и
  нормализованный ответ, итог, HTTP-статус, длительность, раунд, метод, `trigger`
  (`pipeline | cron | admin`), версия адаптера. Только вставка.
- `receipt_event` — «Путь чека», только вставка, пишется в той же транзакции, что и изменение чека
  (`receipt_journey/service.py::record`). Поля: `seq, at, kind, actor_type, actor_id, source,
  outcome, check_id, data`.
- `kind`: `received, validated, risk_flagged, sent_to_moderation, check_round_started,
  provider_checked, provider_skipped, verified, check_round_failed, check_exhausted, approved,
  rejected, bonus_changed, comment_added, edited, reprocess_requested, deleted, included_in_payout,
  paid_out, payout_reverted` (`sent_to_revision` пишет отключённое действие «на доработку», которое отклоняет чек; `recheck_requested` не пишется).
- Миграция `0011` восстановила события старых чеков с `data.backfilled = true`.
- Чтение: `GET /receipts/{id}/journey` (админ). Продавцу недоступно.
