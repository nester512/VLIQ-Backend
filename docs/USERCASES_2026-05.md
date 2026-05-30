# VLIQ-BOT — User Cases & Реальный статус (2026-05)

> Что работает фактически в текущем dev/preprod-стэке. Метки:
> - ✅ **РАБОТАЕТ** — проверено end-to-end (curl или live e2e)
> - ⚠️ **РАБОТАЕТ С ОГРАНИЧЕНИЕМ** — функция есть, но за demo-флагом / без реального backend-провайдера
> - 🚧 **WIRED, нужен данные** — код есть, но требует данные/настройку извне
> - ❌ **НЕ РАБОТАЕТ** — заглушка / стаб / не реализовано

---

## 👤 Seller (продавец)

### Onboarding
| User case | Статус | Где живёт |
|---|---|---|
| Открыть Mini App через `/start` в боте | ✅ | bot/`__main__.py` → `WebAppInfo(url=TMA_URL)` |
| Auth через TMA initData (HMAC) | ✅ | `auth/router.py::tma_verify` |
| Auto-create pending-seller на первом входе | ✅ | `auth/router.py:75` + `seller/router.py::get_me` auto-heal |
| Заполнить регистрацию (RegPage) | ✅ | `RegPage.tsx` |
| Подставить телефон из Telegram (`requestContact`) | ✅ | `RegPage.tsx:160-172` |
| Подставить телефон в СБП-поле автоматом | ✅ | `RegPage.tsx:90-109` |
| Зашифровать payout_account_raw (Fernet) | ✅ | `update_me` + `PayoutCrypto` |
| Авто-флип `pending → active` после заполнения | ✅ | `update_me` (исключение: phone `+99...` — synthetic, не флипает) |
| `invalidateQueries` + `navigate('/seller/home')` после submit | ✅ | `RegPage.tsx:147-152` |

### Главная (HomePage)
| User case | Статус |
|---|---|
| Hero balance с counter-tween | ✅ |
| Quick-actions (загрузить чек, баланс) | ✅ |
| Последние чеки | ✅ |
| Уведомления (badge unread) | ✅ |

### Загрузка чека
| User case | Статус | Детали |
|---|---|---|
| Загрузить фото с галереи | ✅ | `<input type="file" accept="image/*">` |
| Снять фото камерой Telegram | ✅ | `<input capture="environment">` (line 239) + `OptionBtn "Камера"` |
| Сканировать QR через Telegram WebApp | ✅ | `tgApp.showScanQrPopup` (line 107) |
| Прогресс-бар при загрузке | ✅ | XHR + `setProgress` |
| Presigned-upload (S3 direct) | ✅ при `RECEIPT_STORAGE=s3` | сейчас активно (MinIO) |
| Fallback на multipart-upload | ✅ | при 501 от `/upload-url` |
| QR-payload submit (без файла) | ⚠️ **BUG** | `UniqueViolationError` на пустом `file_hash` если уже есть pending — A4 нашёл |

### Пайплайн чека
| User case | Статус | Детали |
|---|---|---|
| OCR извлечение QR из фото | ⚠️ **DEMO** | `OCR_MODE=demo` сейчас → пайплайн всегда возвращает demo-данные с fraud-signal `"demo_mode"`. Код реальной QR-экстракции (`zxing-cpp`) есть и работает, но не вызывается в demo-режиме |
| OFD lookup (проверка чека в ФНС) | ❌ **FAKE** | `OFD_PROVIDER=fake` → `FakeOFDClient` всегда возвращает canned data. `PROVERKACHEKA_TOKEN` есть, но не задействован |
| Pipeline retry/backoff | ✅ | `OFD_TIMEOUT_SECONDS`, `OFD_RETRY_MAX_ATTEMPTS` |
| Structured logging этапов | ✅ | `pipeline.start/qr_extracted/ofd_call/ofd_response/complete` |
| Fraud signals в receipt | ✅ | JSONB column |
| Status state machine | ✅ | pending → ocr_in_progress → on_review → approved/rejected/needs_revision → paid_out |

### Статус чека
| User case | Статус |
|---|---|
| Polling `/receipts/:id/status` | ✅ |
| Отображение прогресса с timeline | ✅ |

### Баланс + история
| User case | Статус |
|---|---|
| `GET /sellers/me/balance` (available/on_hold/total) | ✅ |
| `GET /bonus-transactions` (paged) | ✅ |
| Skeletons во время загрузки | ✅ |

### Выплаты
| User case | Статус |
|---|---|
| Запросить выплату | ✅ |
| Валидация суммы vs available | ✅ (backend: `PAYOUT_INSUFFICIENT_BALANCE`) |
| История заявок (статусы) | ✅ |

### Профиль
| User case | Статус |
|---|---|
| Просмотр данных | ✅ |
| Помощь администратора (открывает чат) | ⚠️ хардкод `@vliq_support` |

---

## 👨‍💼 Admin

### Auth
| User case | Статус | Детали |
|---|---|---|
| `POST /auth/login {id}` (DEV) | ✅ | работает после миграции 0003_admin_table |
| Роль admin / super_admin из `vliq.admin` | ✅ | 99998=admin, 99999=super_admin |
| `require_admin` принимает обе роли | ✅ | super_admin ⊃ admin |

### Dashboard (`/admin/dash`)
| User case | Статус |
|---|---|
| Метрики (sellers / receipts / payouts) | ✅ |
| Top sellers (агрегат) | ✅ |
| Chart-buckets (по дням) | ✅ |
| Counter-tween на цифрах | ✅ |

### Review queue (`/admin/review`)
| User case | Статус |
|---|---|
| Список on_review чеков (SwipeDeck) | ✅ |
| Свайп right → approve | ✅ |
| Свайп left → открывает `RejectReasonSheet` | ✅ |
| Quick-pick chips ("Дубль", "Не от продавца", "Сумма не совпадает") | ✅ |
| 409 при попытке approve уже-approved | ✅ **больше не возникает** — в этой волне зафиксили: action-кнопки рендерятся только для `on_review` |
| Friendly 409 envelope `RECEIPT_INVALID_STATE_TRANSITION` | ✅ |
| Infinite scroll загрузка | ✅ |
| Skeleton на старте | ✅ |

### ReceiptDetailSheet (карточка чека)
| User case | Статус | Детали |
|---|---|---|
| Одобрить / Доработка / Отклонить | ✅ — **только если status=on_review** | gate в этой волне |
| Изменить бонус | ✅ | `PATCH /receipts/:id/bonus` (correction-row на approved) — gate: on_review/approved |
| Комментарий | ✅ | `POST /receipts/:id/comment` → JSONB `admin_comments` |
| Заблокировать пользователя | ✅ | `POST /sellers/:id/block` → outbox-уведомление |
| Просмотр fraud-signals | ✅ |

### Payouts (`/admin/payouts`)
| User case | Статус |
|---|---|
| Список заявок по статусам | ✅ |
| Approve / Reject выплаты | ✅ (после фикса InvalidRequestError) |
| Excel-выгрузка | ❌ toast-stub `Excel-выгрузка — скоро` |

### Sellers (`/admin/sellers`)
| User case | Статус |
|---|---|
| Список продавцов + пагинация | ✅ |
| Поиск (с фокус-border + glow) | ✅ |
| Открыть карточку | ✅ |
| Балланс + кол-во чеков в карточке | ✅ (SellerReadAdmin) |
| Кнопка "К чекам" → `/admin/sellers/:id/receipts` | ✅ |
| Список чеков конкретного продавца | ✅ |
| Блок / Анблок продавца | ✅ |

### Заметки / уведомления / outbox
| User case | Статус |
|---|---|
| Notifications outbox (idempotent + retry) | ✅ |
| Telegram-channel доставка | ✅ если бот polling/webhook жив |
| In-app notifications (DB row) | ✅ |

---

## 👑 Super-admin
Сейчас имеет все admin-привилегии. Отдельных super_admin-only endpoints **нет**. `require_super_admin` зарезервирован, но не подключён ни к одному роуту.

---

## 🤖 Telegram Bot
| User case | Статус |
|---|---|
| `/start` → WebApp кнопка | ✅ (aiogram 3, polling) |
| `/help` | ✅ |
| Long-polling mode | ✅ |
| Webhook mode (env-toggle) | 🚧 код есть, нужна Caddyfile route + `BOT_MODE=webhook` |
| Отправка push-уведомлений через outbox | ✅ |

---

## 🔍 QR / Камера / OFD — отдельный блок (твой вопрос)

### Распознавание QR с фото
**Код:** ✅ полностью реализован — `backend/src/receipt_ocr/qr_extractor.py`
- Библиотека: **zxing-cpp** (Python wheel, bundled — без системных зависимостей)
- Функция `extract_qr_from_image(data: bytes) -> str | None`
- Поддерживает multi-QR-фото — выбирает тот, что матчит русский фискальный паттерн `t=\d{8}T\d{4}`

**Что в проде сейчас:** ❌ **не вызывается** — потому что `OCR_MODE=demo` в текущем `.env`. В demo-режиме `orchestrator._process_demo` сразу пишет фиктивные данные с fraud-signal `"demo_mode"` и пропускает реальный OCR.

**Чтобы включить:** в `.env` поменять `OCR_MODE=real` (или удалить переменную — default не demo). Перезапустить backend. Реальная QR-экстракция начнёт работать сразу.

### Использование камеры в Web App
**Реализовано:** ✅ две независимые точки входа в `UploadPage.tsx`:

1. **Camera input** (line 239):
   ```html
   <input type="file" accept="image/*" capture="environment" hidden />
   ```
   Open via `OptionBtn "Камера"` — Telegram WebView откроет нативную камеру.

2. **Telegram QR Scanner** (line 107):
   ```js
   tgApp.showScanQrPopup({ text: 'Отсканируйте QR-код на чеке' }, (data) => {...})
   ```
   Откроет встроенный QR-сканер Telegram (без фото — сразу строка).

Оба пути отрабатывают.

### OFD API
**Код:** ✅ реализовано 2 провайдера:
- `FakeOFDClient` — всегда возвращает canned data (для dev/demo)
- `ProverkachekaClient` — реальный HTTP-клиент с retry/backoff/structured logging. Уже усилен в волне D3:
  - `Retry-After` header на 429
  - Exponential backoff на 5xx
  - Fast-fail на 401/403/404
  - `OFD_TIMEOUT_SECONDS` / `OFD_RETRY_MAX_ATTEMPTS` из env

**Что в проде сейчас:** ❌ **используется fake** — `OFD_PROVIDER=fake` в `.env`. `PROVERKACHEKA_TOKEN` уже установлен.

**Чтобы включить real OFD:** в `.env`:
```
OFD_PROVIDER=proverkacheka
```
Перезапустить backend. Каждое поступление чека будет реально верифицироваться через `https://proverkacheka.com/api/v1`.

---

## Что есть на следующей итерации

### P0
- **`POST /receipts/qr-payload` UniqueViolation на file_hash=''** (нашёл live-e2e). Fix: hash от QR-строки или unique constraint `WHERE file_hash != ''`
- **OCR_MODE flip** на real когда готовы тестировать пайплайн end-to-end
- **OFD_PROVIDER=proverkacheka** активация

### P1
- 21 BE-stub'ов скрыты из OpenAPI (нет потребителя на FE) — можно постепенно реализовывать по мере появления UI
- Excel-выгрузка payouts (сейчас toast-stub)
- 13 dead BE endpoints — audit-logs/retry без UI

### P2
- Super-admin-only routes (нет пока ни одного)
- Webhook bot mode wiring (полный prod-deploy)
- HSTS preload / OCSP в Caddy

---

## Где жить дальше
- `docs/CONTRACT_AUDIT_2026-05.md` — точная карта 47 BE / 28 FE / 4 toast-stub / 13 dead
- `e2e-real/` — 15 live-тестов поверх работающего стека
- `e2e/` — 42 mock-теста для регрессии без backend
