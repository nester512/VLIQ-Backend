# VLIQ-BOT — User Stories & Screen Map

> Аудитория: product / dev / QA.
> Цель: дать новому разработчику полную ментальную модель каждого флоу без чтения кода.
> Источники: код прочитан напрямую (маршрутизатор, страницы, шиты, API, backend-оркестратор, docker-compose).

---

## Section 1 — Overview

VLIQ-BOT — это Telegram Mini App (TMA) для программы лояльности бренда «VLIQ»: продавцы фотографируют или сканируют чеки на товары бренда, бэкенд проверяет подлинность чека через ФНС (OFD API proverkacheka.com), начисляет бонус, администратор подтверждает через swipe-очередь, а затем переводит бонус на банковские реквизиты продавца.

**Роли:**

| Роль | Описание | Права |
|---|---|---|
| `seller` | Продавец в торговой точке | Загрузка чеков, просмотр баланса, запрос выплаты |
| `admin` | Сотрудник бренда | Проверка чеков, управление выплатами, просмотр продавцов |
| `super_admin` | Старший админ | Всё что admin; отдельных super_admin-only endpoints пока нет |
| `bot` | Telegram-бот (системный актор) | Рассылка уведомлений через outbox |

**Lifecycle чека + бонуса:**

```
Продавец загружает фото/QR
      ↓
Backend: presigned S3 upload → arq-очередь
      ↓
receipt-pipeline-worker: QR-extract → fraud check → OFD call → SKU match → bonus calc
      ↓
Статус on_review → уведомление продавцу
      ↓
Администратор: swipe-approve / reject / revise
      ↓
Статус approved → INSERT bonus_transaction → уведомление продавцу
      ↓
Продавец запрашивает выплату → PayoutRequest (new → in_progress → paid)
      ↓
Статус paid_out
```

---

## Section 2 — Auth & Onboarding Flow

### 2.1 TMA Auth (production path)

```
Telegram WebView открывает https://<host>/
        ↓
App.tsx → AuthGate → useAuthFlow()
        ↓
isTmaEnvironment() || isLikelyTmaContext() ?
  YES → waitForInitData(2500ms)   ← Android-delay fix
        ↓
  tmaVerify({ init_data: window.Telegram.WebApp.initData })
  POST /api/v1/auth/tma-verify
  BE: HMAC-SHA256 validate → find or create seller → JWT (role)
        ↓
  setAuth(token, role) → RoleRedirect
```

- `waitForInitData` ждёт до 2500 мс, опрашивая `window.Telegram.WebApp.initData` каждые 100 мс — специальный хак для Android, где initData прилетает с задержкой после первой отрисовки.
- `isLikelyTmaContext` проверяет `window.Telegram?.WebApp` ИЛИ `#tgWebAppData` в URL-фрагменте — ловит случаи, когда SDK ещё не инициализирован.

### 2.2 DEV Fallback

Когда `import.meta.env.DEV`:

1. При `isLikelyTmaContext()` внутри Telegram — `tmaVerify` завершается ошибкой → автоматический fallback на `POST /auth/login { id: <tgUserId> }`.
2. При отсутствии TMA-контекста — AuthGate рендерит кнопку «Mock Login (DEV)» → `loginByTgId({ id: 12345 })`.

`/auth/login` **не работает в production** (возвращает 404) — только dev-стенд.

### 2.3 Авто-создание продавца

При первом TMA-логине бэкенд (`/auth/tma-verify`) создаёт запись `seller` со статусом `pending`. `SellerProfileGate` в `AppRouter.tsx` проверяет `profile.status === 'pending'` и редиректит на `/seller/reg`.

**Auto-heal после сброса БД:** если токен валидный, а `GET /sellers/me` возвращает 404 — аксиос-интерсептор очищает токен → повторный вход создаёт продавца заново.

### 2.4 AuthGate — состояния

| Состояние | Что видит пользователь |
|---|---|
| `loading` | Полноэкранный спиннер + «Авторизация…» |
| `authenticated` | Дети (AppRouter) |
| `error` (outside Telegram) | 💬 «Открой @BotName в Telegram» + кнопка «Открыть @BotName» |
| `error` (TMA signature fail) | ⚠️ «Не удалось проверить подпись» + «Попробовать снова» |
| `idle` + DEV | Кнопка «Mock Login (DEV)» |

### 2.5 Открытие вне Telegram

`handleOpenBot` в `AuthGate` — умный: если `Telegram.WebApp.openTelegramLink` доступен (сломанный WebView) — вызывает его; иначе `window.open("https://t.me/<bot>")`. Это ловит сценарий «вкладка Telegram внутри, но Mini App не запустился».

---

## Section 3 — Per-Role Screen Maps

### 3.1 Seller Screens

---

#### `/seller/home` — HomePage

**Компонент:** `frontend/src/features/seller/pages/HomePage.tsx`

**Что видит продавец:**
- `HeroBalance` — доступный баланс (рублей) + «всего заработано», кнопка «Снять»
- 4 `QuickActionCard` в 2 колонки: «Загрузить чек», «Мой баланс», «История», «Акции»
- Секция «Последние чеки» — 3 последних `ReceiptRow`, кнопка «Все»
- `EmptyState` если чеков нет

**Данные:**

| Ключ | Endpoint | staleTime |
|---|---|---|
| `['sellers', 'me', 'balance']` | `GET /sellers/me/balance` | 30s |
| `['receipts', 'me', { limit: 50 }]` | `GET /sellers/me/receipts?limit=50` | 30s |

**Переходы IN:** RoleRedirect (после auth), navigate('/seller/home') из любого экрана

**Переходы OUT:**

| Действие | Куда |
|---|---|
| QuickAction «Загрузить чек» | `/seller/upload` |
| QuickAction «Мой баланс» | `/seller/balance` |
| QuickAction «История» | `/seller/history` |
| QuickAction «Акции» | `/seller/promo` |
| HeroBalance «Снять» | `/seller/payout` |
| ReceiptRow click | `/seller/status/:id` |
| «Все» (recent receipts) | `/seller/history` |

**User stories:**

- Как продавец, я хочу видеть текущий баланс сразу при открытии приложения, чтобы понимать, сколько могу вывести.
- Как продавец, я хочу видеть последние чеки на главной, чтобы быстро убедиться, что загрузка прошла успешно.
- Как продавец, я хочу одним кликом перейти к загрузке нового чека, чтобы не тратить время на навигацию.

**Edge cases:**
- Баланс 0 → HeroBalance рендерит «0 ₽», кнопка «Снять» ведёт на PayoutPage где checklist покажет ошибку
- Нет чеков → EmptyState «Чеков пока нет» + кнопка «Загрузить чек»
- Сеть недоступна → HeroSkeleton + ReceiptRowSkeleton остаются; ErrorBoundary ловит рендер-ошибки

---

#### `/seller/reg` — RegPage

**Компонент:** `frontend/src/features/seller/pages/RegPage.tsx`

**Что видит продавец:**
- Заголовок «Расскажите о себе» + подзаголовок
- Прогресс-индикатор (2 полоски)
- **Шаг 1:** Имя, Фамилия, Телефон (+ кнопка «Использовать телефон из Telegram»), Город
- **Шаг 2:** Торговая точка, Адрес (необязательно), Должность (необязательно), Способ выплаты (СБП / Карта / СБП·банк), Реквизиты, Чекбокс согласия ПДН

**Данные:**
- `PATCH /sellers/me` при сабмите
- При успехе: `queryClient.setQueryData(['sellers', 'me'], profile)` + `invalidateQueries` + navigate → `/seller/home`

**Авто-подстановка:**
- `prefillFromTelegram()` — при монте читает `Telegram.WebApp.initDataUnsafe.user` и заполняет имя/фамилию/телефон
- `requestContact` (кнопка «Использовать телефон из Telegram») — вызывает нативный диалог Telegram, фокус переходит на поле «Город»
- **SBP autofill**: при выборе способа `sbp_phone` поле `payout_details` автоматически заполняется значением поля `phone`, если реквизиты ещё пусты; флаг `sbpAutoFilled.current` предотвращает перезапись ручного ввода

**Валидация:**
- Шаг 1: все 4 поля обязательны; телефон — E.164 (`+7XXXXXXXXXX`)
- Шаг 2: store_name, payout_method, payout_details обязательны; checked — согласие ПДН
- `touched`-флаги: ошибки показываются только после `onBlur` или нажатия «Далее»/«Завершить»

**Переходы IN:** SellerProfileGate (status=pending → redirect) / ProfilePage «Заполнить»

**Переходы OUT:** `/seller/home` (при успехе)

**User stories:**

- Как новый продавец, я хочу быстро заполнить профиль используя данные из Telegram, чтобы не вводить их вручную.
- Как продавец, я хочу чтобы СБП-реквизиты заполнились автоматически из телефона, чтобы не допустить опечатку.
- Как продавец, я хочу понимать, на какой шаг из двух я нахожусь, чтобы не удивиться длине формы.

**Edge cases:**
- `PATCH /sellers/me` 422 → toast «Заполните подсвеченные поля»
- Не нажали «Согласие» → toast «Подтвердите согласие на обработку данных»
- Статус продавца не переходит в `active` если телефон начинается с `+99` (синтетические данные dev-сида)

---

#### `/seller/upload` — UploadPage

**Компонент:** `frontend/src/features/seller/pages/UploadPage.tsx`

**Что видит продавец:**
- Загрузочный бокс с пунктирной границей (placeholder или превью файла / QR-строка)
- 3 кнопки: «Камера», «PDF / файл», «QR-код»
- Список «Что проверит система»: дата/сумма, магазин, антифрод, акция
- Информационный баннер «После загрузки бот ответит...»
- Прогресс-бар + процент (только во время загрузки на S3)
- Кнопка «Отправить чек» / «Выберите файл»

**Upload пути:**

| Путь | Когда используется | API |
|---|---|---|
| Presigned S3 | `RECEIPT_STORAGE=s3` | `POST /receipts/upload-url` → PUT на presigned URL → `POST /receipts/finalize` |
| Multipart fallback | `upload-url` → 501 | `POST /receipts/upload` (multipart) |
| QR payload | `showScanQrPopup` / нет Telegram QR → file input | `POST /receipts/qr-payload` |

**QR-сканер:** `Telegram.WebApp.showScanQrPopup` → строка QR → `setScannedQr`; если метод недоступен (не TMA) — открывается `<input type="file">`.

**Прогресс:** `useUploadReceipt` хук передаёт `onProgress(pct)` callback → XHR `upload.onprogress` → `setUploadProgress`.

**Переходы IN:** QuickAction с HomePage, TabBar навигация

**Переходы OUT:** `/seller/status/:id` после успешной загрузки

**User stories:**

- Как продавец, я хочу отсканировать QR прямо в Telegram, чтобы не делать фото и ждать OCR.
- Как продавец, я хочу видеть прогресс загрузки файла, чтобы знать что всё идёт нормально.
- Как продавец, я хочу понимать, что именно проверяет система, чтобы не удивляться когда чек отклоняют.

**Edge cases:**
- Файл не выбран → кнопка «Выберите файл» задизейблена
- `RECEIPT_EMPTY_FILE` → toast с русским сообщением
- `RECEIPT_DUPLICATE` → toast «Этот чек уже был загружен ранее»
- Загрузка идёт → `isPending=true` → все кнопки задизейблены, прогресс-бар виден

---

#### `/seller/status/:id` — StatusPage

**Компонент:** `frontend/src/features/seller/pages/StatusPage.tsx`

**Что видит продавец:**
- Статус-карточка: иконка (check / clock / alert / x), заголовок, подзаголовок, пилюля статуса
- Причина отклонения (если `rejected`)
- Таймлайн из 4 шагов: Чек получен → Данные распознаны → Проверка администратором → Начисление бонуса
- Карточка «Предварительный бонус» / «Начислено» (если `bonus_amount > 0`)

**Данные:**

| Ключ | Endpoint | Polling |
|---|---|---|
| `['receipt-status', id]` | `GET /receipts/:id/status` | 3s если `pending` / `ocr_in_progress` |

Polling останавливается автоматически при terminal-статусах (`approved`, `rejected`, `paid_out`, `needs_revision`, `on_review`).

**Переходы IN:** UploadPage после upload, ReceiptRow click в HomePage/HistoryPage

**Переходы OUT:** Назад (TG Back Button или in-app back вне TMA)

**User stories:**

- Как продавец, я хочу видеть реалтайм статус чека, чтобы не гадать принят ли он.
- Как продавец, я хочу понимать где именно в процессе находится мой чек, чтобы не тревожиться при долгой обработке.
- Как продавец, я хочу видеть причину отклонения, чтобы знать что исправить при повторной подаче.

**Edge cases:**
- `id` не существует → `isError=true` → EmptyState «Не удалось загрузить чек» + кнопка «Обновить»
- `retry: false` — не делает повторных запросов при 401 (не сжигает токен)

**Status → Visual map:**

| Status | Icon | Kind | Polling |
|---|---|---|---|
| `pending` | clock | wn | да (3s) |
| `ocr_in_progress` | clock | wn | да (3s) |
| `on_review` | clock | wn | нет |
| `needs_revision` | alert | wn | нет |
| `approved` | check | ok | нет |
| `paid_out` | check | ok | нет |
| `rejected` | x | dg | нет |

---

#### `/seller/balance` — BalancePage

**Компонент:** `frontend/src/features/seller/pages/BalancePage.tsx`

**Что видит продавец:**
- `HeroBalance` — доступный баланс + кнопка «Запросить выплату»
- 4 `MetricCard` (2×2): «На проверке», «Всего начислено», «Всего выплачено», «Чеков одобрено»
- `FilterPills`: Все / Начисления / Выплаты
- Список `AccrualRow` — транзакции баланса

**Данные:**

| Ключ | Endpoint | staleTime |
|---|---|---|
| `['sellers', 'me', 'balance']` | `GET /sellers/me/balance` | 30s |
| `['receipts', 'me', { limit: 200 }]` | `GET /sellers/me/receipts?limit=200` | 30s |
| `['bonus-transactions', 'me']` | `GET /bonus-transactions?limit=100` | 30s |

**Примечание:** счётчик «Чеков одобрено» и «На проверке» считается client-side из `receipts` — бэкенд не возвращает их в balance endpoint.

**Переходы IN:** QuickAction с HomePage, TabBar

**Переходы OUT:** `/seller/payout` через кнопку HeroBalance

**User stories:**

- Как продавец, я хочу видеть детальную разбивку баланса, чтобы понимать откуда появились и куда ушли деньги.
- Как продавец, я хочу фильтровать историю по типу операции, чтобы быстро найти нужную транзакцию.

**Edge cases:**
- Нет транзакций → EmptyState «Начислений пока нет»
- Фильтр активен + нет результатов → «Пусто под этот фильтр»

---

#### `/seller/history` — HistoryPage

**Компонент:** `frontend/src/features/seller/pages/HistoryPage.tsx`

**Что видит продавец:**
- `SearchBar` — поиск по номеру чека (ID)
- `FilterPills`: Все / Одобрены / На проверке / Отклонены
- Список `ReceiptRow` (отфильтрованный)

**Данные:**

| Ключ | Endpoint | staleTime |
|---|---|---|
| `['receipts', 'me', { status }]` | `GET /sellers/me/receipts?status=...` | 30s |

Поиск — client-side фильтрация по `receipt.id.includes(search)` (не API).

**Переходы IN:** QuickAction / TabBar

**Переходы OUT:** `/seller/status/:id`

**User stories:**

- Как продавец, я хочу фильтровать чеки по статусу, чтобы видеть только одобренные и понять сколько заработал.
- Как продавец, я хочу искать чек по номеру, чтобы быстро найти нужный в длинном списке.

**Edge cases:**
- Нет чеков → EmptyState «Чеков пока нет»
- Поиск + нет результатов → «Ничего не нашли»

---

#### `/seller/promo` — PromoPage

**Компонент:** `frontend/src/features/seller/pages/PromoPage.tsx`

**Что видит продавец:**
- Список `PromoCard` — карточки активных акций с условиями
- Информационный баннер «Участие без действий — достаточно соответствовать условиям»

**Данные:**

| Ключ | Endpoint | staleTime |
|---|---|---|
| `['promotions']` | `GET /promotions?only_active=true` | (через usePromotions hook) |

**Переходы IN:** QuickAction / TabBar

**User stories:**

- Как продавец, я хочу видеть текущие акции, чтобы знать, какие товары принесут мне бонус.
- Как продавец, я хочу знать что участие автоматическое, чтобы не беспокоиться о регистрации в акции.

**Edge cases:**
- Нет акций → EmptyState «Сейчас акций нет»

---

#### `/seller/profile` — ProfilePage

**Компонент:** `frontend/src/features/seller/pages/ProfilePage.tsx`

**Что видит продавец:**
- Аватар (TG фото или инициалы), имя, «магазин · город»
- Если `status=pending` → бэйдж «Заполнить» → `/seller/reg`
- NavRow: «Мой баланс» → `/seller/balance`
- NavRow: «Реквизиты выплаты» → значение `••••XXXX` → `/seller/payout`
- NavRow: «Уведомления» → `openSheet('notif')`
- NavRow: «Помощь администратора» → `openTelegramChat('vliq_support')` + toast
- DEV-only: кнопка «[DEV] Выйти»

**Данные:**

| Ключ | Endpoint | staleTime |
|---|---|---|
| `['sellers', 'me']` | `GET /sellers/me` | 60s |

**Переходы IN:** TabBar (4-я вкладка)

**User stories:**

- Как продавец, я хочу быстро открыть поддержку через Telegram, чтобы получить помощь без выхода из приложения.
- Как продавец, я хочу видеть своё имя и точку, чтобы убедиться что авторизован правильно.

**Edge cases:**
- Данные не загружены → `ProfileCardSkeleton`
- Username поддержки хардкодирован (`@vliq_support`) — TODO в коде: заменить на значение с бэкенда

---

#### `/seller/payout` — PayoutPage

**Компонент:** `frontend/src/features/seller/pages/PayoutPage.tsx`

**Что видит продавец:**
- `HeroBalance` — только доступный баланс
- Read-only поля: сумма выплаты (= available), способ, реквизиты (маскированные)
- Если реквизиты не заполнены → кнопка «Заполнить реквизиты →» → `/seller/reg`
- Чеклист «Проверка перед выплатой»: min ≥ 1 000 ₽, реквизиты заполнены, блокировок нет, подозрит. активности нет
- Информационный баннер о статусах «Новая → В обработке → Выплачена»
- Кнопка «Запросить <сумма>» (задизейблена пока не все чекпоинты зелёные)

**Данные:**

| Ключ | Endpoint |
|---|---|
| `['sellers', 'me', 'balance']` | `GET /sellers/me/balance` |
| `['sellers', 'me']` | `GET /sellers/me` |

**Мутация:** `POST /payout-requests` — отправляет `{ amount, method, details }`.

**Переходы IN:** HeroBalance «Снять», ProfilePage «Реквизиты выплаты», `/seller/balance` кнопка

**User stories:**

- Как продавец, я хочу запросить выплату в один клик, чтобы процесс был предельно простым.
- Как продавец, я хочу видеть причины почему выплата недоступна, чтобы знать что нужно исправить.
- Как продавец, я хочу видеть маскированные реквизиты, чтобы убедиться что деньги пойдут на правильный счёт.

**Edge cases:**
- `available < 1000` → чеклист «Минимальная сумма» красный, кнопка задизейблена
- `PAYOUT_INSUFFICIENT_BALANCE` (backend race) → toast
- `noFlag = true` всегда (TODO: подключить реальный антифрод-сигнал)

---

### 3.2 Admin Screens

---

#### `/admin/dash` — DashPage

**Компонент:** `frontend/src/features/admin/pages/DashPage.tsx`

**Что видит администратор:**
- Заголовок «Сводка»
- 4 `MetricCard` (2×2): «Продавцов», «Активных», «Чеков загружено», «На проверке»
- `MiniBarChart` «Динамика чеков (бета)» — бар-чарт по временным бакетам
- QuickNav к «Проверить чеки» / «Заявки на выплату» / «Продавцы» (с живыми счётчиками)
- `TopSellersBoard` — топ продавцов по одобренным чекам

**Данные (N+4 hack — выделенного dashboard endpoint нет):**

| Ключ | Endpoint |
|---|---|
| `['admin', 'sellers', { limit: 200 }]` | `GET /sellers?limit=200` |
| `['admin', 'payouts', { limit: 200 }]` | `GET /payout-requests?limit=200` |
| `['admin', 'receipts', {}]` | `GET /receipts?limit=200` |
| `['admin', 'receipts', { status: 'on_review' }]` | `GET /receipts?status=on_review&limit=1` |

Все 4 запроса агрегируются в `useAdminDashboard` hook.

**Переходы IN:** RoleRedirect (admin/super_admin), AdminLayout root

**Переходы OUT:** `/admin/review`, `/admin/payouts`, `/admin/sellers`, `openSheet('seller', …)`

**User stories:**

- Как администратор, я хочу с первого взгляда видеть очередь чеков на проверке, чтобы понять срочность работы.
- Как администратор, я хочу видеть топ продавцов, чтобы поощрять самых активных.

**Edge cases:**
- Нет данных → MetricCard показывает «—», TopSellersBoard → EmptyState

---

#### `/admin/review` — ReviewPage

**Компонент:** `frontend/src/features/admin/pages/ReviewPage.tsx`

**Что видит администратор:**
- Полноэкранный `SwipeDeck` (position: absolute, overflow: hidden — `noScroll=true` в AdminLayout)
- Карточка чека в центре: превью, имя продавца, сумма, статус антифрод
- Свайп влево = approve (зелёный)
- Свайп вправо = reject → открывается `RejectReasonSheet`
- Тап на карточку → `openSheet('detail', …)` → `ReceiptDetailSheet`
- `undoTrigger` — если admin закрыл RejectReasonSheet без подтверждения, карточка возвращается в дек

**Данные:**

| Ключ | Endpoint | Тип |
|---|---|---|
| `['admin', 'review-queue']` | `GET /receipts?status=on_review` | infinite query (страницы) |

Prefetch следующей страницы начинается когда до конца деки осталось < 5 карточек.

**Действия:**

| Свайп | API | Примечание |
|---|---|---|
| Approve (left) | `POST /receipts/:id/approve` | Немедленно |
| Reject (right) | `POST /receipts/:id/reject { comment }` | После `RejectReasonSheet` |
| Revise | `POST /receipts/:id/revise` | Только из `ReceiptDetailSheet` |

**Переходы IN:** QuickNav / AdminLayout TabBar

**User stories:**

- Как администратор, я хочу одобрять чеки свайпом, чтобы проходить очередь быстро и не утомляться.
- Как администратор, я хочу ввести причину отклонения, чтобы продавец знал что исправить.
- Как администратор, я хочу что карточка возвращалась если я передумал отклонять, чтобы не совершать случайных ошибок.

**Edge cases:**
- `RECEIPT_INVALID_STATE_TRANSITION` (409) → toast, action-кнопки не рендерятся для уже обработанных чеков (action gate fix)
- Пустая очередь → EmptyState «Чеков на проверке нет»

---

#### `/admin/payouts` — PayoutsPage

**Компонент:** `frontend/src/features/admin/pages/PayoutsPage.tsx`

**Что видит администратор:**
- 2 `MetricCard`: «К выплате» (pending total) + «Выплачено в <месяц>»
- `FilterPills`: Все / Новые / В обработке / Выплачены
- Кнопка «Excel-выгрузка» (toast-stub `«Excel-выгрузка — скоро»`)
- Список `PayoutRow` с суммой, методом, статусом
- Клик на строку → `openSheet('payout', …)` → `PayoutDetailSheet`

**Данные:**

| Ключ | Endpoint |
|---|---|
| `['admin', 'payouts', { limit: 200 }]` | `GET /payout-requests?limit=200` (агрегат) |
| `['admin', 'payouts', { status, limit: 100 }]` | `GET /payout-requests?status=…&limit=100` (список) |

**Переходы IN:** QuickNav / TabBar

**User stories:**

- Как администратор, я хочу видеть общую сумму к выплате, чтобы планировать бюджет.
- Как администратор, я хочу фильтровать заявки по статусу, чтобы сосредоточиться на новых.

**Edge cases:**
- Нет заявок → EmptyState
- `statusFilter='all'` + пусто → «Заявок пока нет»

---

#### `/admin/sellers` — SellersPage

**Компонент:** `frontend/src/features/admin/pages/SellersPage.tsx`

**Что видит администратор:**
- `SearchBar` с focus-border / glow при фокусе
- `FilterPills`: Все / Активные / Заблокированные
- Список `SellerRow` (аватар-инициалы, имя, магазин · город, пилюля статуса)
- Клик на строку → `openSheet('seller', { telegram_id })` → `SellerDetailSheet`

**Данные:**

| Ключ | Endpoint |
|---|---|
| `['admin', 'sellers', { search, status, limit: 50 }]` | `GET /sellers?search=…&status=…&limit=50` |

Поиск — server-side (параметр `search` передаётся на бэкенд).

**Переходы IN:** QuickNav / TabBar

**Переходы OUT:** `SellerDetailSheet` → `/admin/sellers/:telegramId/receipts`

**User stories:**

- Как администратор, я хочу быстро найти продавца по имени, чтобы проверить его историю чеков.
- Как администратор, я хочу видеть заблокированных продавцов отдельно, чтобы управлять нарушителями.

**Edge cases:**
- Нет результатов поиска → «Ничего не нашли»
- `telegram_id = null` → кнопка «К чекам» задизейблена

---

#### `/admin/sellers/:telegramId/receipts` — SellerReceiptsPage

**Компонент:** `frontend/src/features/admin/pages/SellerReceiptsPage.tsx`

**Что видит администратор:**
- Подзаголовок «<Имя продавца> · <N> чеков»
- Список `ReceiptRow` (магазин, дата, сумма, статус-пилюля)
- Клик → `openSheet('detail', …)` → `ReceiptDetailSheet`

**Данные:**

| Ключ | Endpoint |
|---|---|
| `['admin', 'seller-detail', parsedId]` | `GET /sellers/:id` |
| `['admin', 'seller-receipts', parsedId]` | `GET /receipts?seller_id=…&limit=50` |

**Переходы IN:** `SellerDetailSheet` кнопка «К чекам»

**Переходы OUT:** Назад (TG Back Button — `useTelegramBack(false)` здесь)

**User stories:**

- Как администратор, я хочу видеть все чеки конкретного продавца, чтобы расследовать подозрительную активность.

**Edge cases:**
- Нет чеков → EmptyState «У продавца пока нет чеков»
- `telegramId` не парсится → `enabled: false` → пустой список

---

### 3.3 Bottom Sheets

---

#### `ReceiptDetailSheet`

**Файл:** `frontend/src/features/admin/sheets/ReceiptDetailSheet.tsx`

**Содержимое:**
- Шапка: аватар-инициалы продавца, «Чек #ID», «магазин · дата», пилюля антифрод (ok / dg)
- `ReceiptGraphic` — стилизованный чек (масштаб 1.18, поворот -2°)
- Кнопка Zoom (toast-stub «Полноэкранный просмотр — скоро»)
- KV-блок: пользователь, дата загрузки, магазин, адрес, сумма, кол-во товаров, ФН/ФД/ФП
- Список товаров (items) + итоговый бонус
- Баннер антифрод-комментарий (зелёный / красный)
- **Action gate:** если `status=on_review` → 3 кнопки «Одобрить / Доработка / Отклонить»; иначе → «Чек уже обработан — действия недоступны»
- Вторичные действия: «Изменить бонус» (только `on_review` или `approved`) + «Комментарий» (всегда)
- «Заблокировать пользователя» (destructive ghost кнопка)

**Субшиты (вложенные):** `EditBonusSheet`, `AddCommentSheet`, `BlockSellerSheet`

**Мутации:**

| Действие | API |
|---|---|
| Одобрить | `POST /receipts/:id/approve` |
| Доработка | `POST /receipts/:id/revise` |
| Отклонить | `POST /receipts/:id/reject` |
| Изменить бонус | `PATCH /receipts/:id/bonus` |
| Комментарий | `POST /receipts/:id/comment` |
| Заблокировать | `POST /sellers/:id/block` → invalidates sellers + receipts + review-queue |

**User stories:**

- Как администратор, я хочу видеть все данные чека в одном месте, чтобы принять взвешенное решение.
- Как администратор, я хочу скорректировать сумму бонуса, чтобы исправить ошибку автоматического расчёта.
- Как администратор, я хочу заблокировать мошенника прямо из чека, чтобы не переходить в другой раздел.

**Edge cases:**
- `receipt=null` → спиннер (данные передаются из ReviewPage/SellerReceiptsPage, не подгружаются)
- 409 на approve → action gate исключает ситуацию до запроса

---

#### `RejectReasonSheet`

**Файл:** `frontend/src/components/molecules/RejectReasonSheet.tsx`

- Textarea (авто-фокус через 120 мс)
- Quick-pick chips: «Дубль чека», «Чек не от продавца», «Сумма не совпадает с QR»
- Валидация: `reason.replace(/\s/g, '').length >= 3`
- Кнопка «Отклонить» — красная, задизейблена пока reason < 3 символов
- При закрытии без подтверждения → `setUndoTrigger(t+1)` → карточка возвращается в SwipeDeck

---

#### `EditBonusSheet`

**Файл:** `frontend/src/components/molecules/EditBonusSheet.tsx`

- Числовой input (type=number, decimal, min=0, max=999_999 рублей)
- Pre-fill: текущий бонус из `currentBonusKopecks / 100`
- `onConfirm(Math.round(parsed * 100))` — конвертирует рубли → копейки
- Валидация: `!isNaN(parsed) && parsed >= 0 && parsed <= 999_999`

---

#### `AddCommentSheet`

**Файл:** `frontend/src/components/molecules/AddCommentSheet.tsx`

- Textarea (авто-фокус через 120 мс), maxLength=2000
- Live-счётчик «N / 2000» справа внизу
- Валидация: `trim().length >= 1 && trim().length <= 2000`

---

#### `BlockSellerSheet`

**Файл:** `frontend/src/components/molecules/BlockSellerSheet.tsx`

- Показывает имя продавца
- Textarea причины блокировки (необязательно, maxLength=500)
- Кнопка «Заблокировать» — красная (`--color-dg`), всегда активна (причина опциональна)
- `onConfirm(reason.trim() || null)`

---

#### `PayoutDetailSheet`

**Файл:** `frontend/src/features/admin/sheets/PayoutDetailSheet.tsx`

- KV: продавец, сумма, способ, реквизиты, статус
- Антифрод-баннер (TODO: заменить на реальный сигнал)
- Action gate: `isActionable = status === 'new' || status === 'in_progress'`
- Кнопки «Подтвердить» (зелёный) / «Отклонить» (красный)
- Terminal статусы → «Заявка завершена — действия недоступны»

---

#### `SellerDetailSheet`

**Файл:** `frontend/src/features/admin/sheets/SellerDetailSheet.tsx`

- Аватар-инициалы, имя, должность, пилюля статуса (Активен / Ожидает / Блок)
- KV: город, точка, телефон, дата регистрации, баланс, чеков всего (+ одобрено — поле `receipts_approved` всегда `undefined`, показывает `0`)
- Кнопка «К чекам» → navigate + closeSheet
- Кнопка «Заблокировать / Разблокировать» → `PATCH /sellers/:id { status }`

---

## Section 4 — Pipeline Flow (Server-Side)

### 4.1 Загрузка → Очередь

```
Продавец → POST /receipts/upload (multipart) ИЛИ
           POST /receipts/upload-url + PUT <presigned> + POST /receipts/finalize ИЛИ
           POST /receipts/qr-payload
            ↓
BE: INSERT Receipt (status=pending, file_url / qr_raw)
            ↓
arq.enqueue("process_receipt", receipt_id)  ← Redis queue
            ↓
receipt-pipeline-worker: ReceiptPipelineOrchestrator.process(receipt_id, session)
```

### 4.2 Pipeline Steps

| # | Шаг | Что делает | Ошибка → статус |
|---|---|---|---|
| 1 | `set_status` | `pending → ocr_in_progress` (state machine check) | `on_review` если переход запрещён |
| 2 | `qr_extract` | Если есть `qr_raw` — parse_qr_string(); иначе zxing-cpp по байтам файла | `needs_revision` |
| 3 | `fraud_early` | qr_raw дубль + fn/fd/fp дубль + date window + cross-seller | `rejected` (дубли) / `on_review` (cross-seller) |
| 4 | `ofd_fetch` | `ProverkachekaClient.get_receipt(fn,fd,fp,t,s)` — cache-first Redis, retry backoff | `needs_revision` (недоступен/rate limit) / `rejected` (not found) |
| 5 | `verify_qr_vs_ofd` | Проверка суммы QR vs OFD, отклонение ≤ 1% | `on_review` |
| 6 | `sku_match` | SkuMatcher по товарам OFD → matched_sku_id / confidence | `on_review` (нет матчей) |
| 7 | `bonus_calc` | `calculate_bonus(active_promotions, context)` → total_amount + breakdown | — |
| 8 | `atomic_commit` | `SELECT … FOR UPDATE` + UPDATE receipt (status=approved, items, bonus_amount, fn/fd/fp) + INSERT bonus_transaction | `on_review` |

**Demo mode:** если `OCR_MODE=demo` — шаги 2-8 пропускаются; сразу `status=on_review`, `bonus_amount=250`, fraud_signal `"demo_mode"`.

**Fake OFD:** если `OFD_PROVIDER=fake` — шаг 4 использует `FakeOFDClient` (canned data). Включить real: `OFD_PROVIDER=proverkacheka`.

**proverkacheka.com payload:** POST форма на `https://proverkacheka.com/api/v1/check/get` с полями `fn`, `fd`, `fp`, `t` (YYYYMMDDTHHMM), `s` (копейки), `n=1`, `qr=0`, `token`.

**Коды ответа proverkacheka:** `code=1` — ok; `{2,4,5}` — not found (→ `OFDNotFoundError`); `3` — blocked; неизвестный — treated as not found.

### 4.3 Диаграмма переходов статусов

```
                    ┌─────────────────────────────────────┐
                    │  Actor: system (pipeline worker)    │
                    │  Actor: admin (manual review)       │
                    └─────────────────────────────────────┘

   [UPLOAD]
      │
      ▼
  pending ──(pipeline step 1)──► ocr_in_progress
                                        │
                         ┌──────────────┤
                         │   QR fail /  │  success through
                         │   fraud dup  │  all steps
                         ▼              ▼
                   needs_revision    on_review ◄── fraud signals /
                         │              │          sku mismatch /
                         │         ┌───┴───┐       ofd upstream fail
                         │    admin│       │admin
                         │    approve  reject/revise
                         │         │       │
                         │         ▼       ▼
                         │      approved  rejected
                         │         │
                         │    (payout flow)
                         │         │
                         │         ▼
                         │      paid_out
                         │
                    (seller re-upload → new receipt)
```

### 4.4 Notifications Outbox

После каждого изменения статуса BE вставляет строку в `notifications` + строку в `notification_outbox`. `notifications-worker` опрашивает outbox, отправляет через Telegram Bot API, маркирует `sent=true`. Retry при ошибке (idempotent).

---

## Section 5 — Error Contract

**Envelope:**
```json
{
  "code": "RECEIPT_DUPLICATE",
  "user_message": "Этот чек уже был загружен ранее.",
  "debug_id": "550e8400-e29b-41d4-a716-446655440000",
  "extra": {}
}
```

**Полная таблица кодов:**

| Код | HTTP | Russian user_message | Ожидаемое действие пользователя |
|---|---|---|---|
| `AUTH_INVALID_INIT_DATA` | 400 | Ошибка авторизации. Попробуй перезапустить приложение. | Перезапустить TMA |
| `AUTH_MISSING_TOKEN` | 401 | Сессия истекла. Перезапусти приложение. | Перезапустить TMA |
| `AUTH_TOKEN_EXPIRED` | 401 | Сессия истекла. Войди снова. | Перезапустить TMA |
| `AUTH_TOKEN_INVALID` | 401 | Токен недействителен. Войди снова. | Перезапустить TMA |
| `AUTH_FORBIDDEN` | 403 | Недостаточно прав для выполнения этого действия. | Обратиться к поддержке |
| `SELLER_BLOCKED` | 403 | Ваш аккаунт заблокирован. Обратитесь в поддержку. | Написать @vliq_support |
| `SELLER_NOT_REGISTERED` | 404 | Продавец не зарегистрирован. | Пройти RegPage |
| `SELLER_NOT_FOUND` | 404 | Продавец не найден. | — (admin side) |
| `RECEIPT_EMPTY_FILE` | 400 | Файл пуст. Попробуй ещё раз. | Выбрать другой файл |
| `RECEIPT_UNSUPPORTED_TYPE` | 400 | Неподдерживаемый формат файла. Загрузи JPG, PNG или PDF. | Выбрать другой файл |
| `RECEIPT_NOT_FOUND` | 404 | Чек не найден. | Вернуться в историю |
| `RECEIPT_NOT_YOURS` | 403 | Этот чек принадлежит другому продавцу. | — |
| `RECEIPT_DUPLICATE` | 409 | Этот чек уже был загружен ранее. | Не загружать повторно |
| `RECEIPT_INVALID_STATE_TRANSITION` | 409 | Этот чек уже обработан. Обнови список. | Обновить список (action gate предотвращает) |
| `QR_PARSE_FAILED` | 400 | Не удалось прочитать QR-код. Попробуй ещё раз. | Отсканировать снова |
| `QR_NOT_FOUND` | 404 | QR-код не найден. | Загрузить фото чека вместо QR |
| `OFD_UPSTREAM_UNAVAILABLE` | 503 | Сервис проверки чеков временно недоступен. Попробуй позже. | Повторить позже |
| `OFD_RECEIPT_NOT_FOUND` | 404 | Чек не найден в базе налоговой. | Убедиться что чек фискальный |
| `PAYOUT_INVALID_AMOUNT` | 400 | Неверная сумма выплаты. | Проверить баланс |
| `PAYOUT_INSUFFICIENT_BALANCE` | 400 | Недостаточно бонусов для выплаты. | Дождаться одобрения чеков |
| `NOT_IMPLEMENTED` | 501 | Функция ещё не реализована. | — |
| `INTERNAL_ERROR` | 500 | Что-то пошло не так. Попробуй ещё раз. | Повторить |
| `VALIDATION_ERROR` | 422 | Проверь введённые данные. | Исправить поля формы |

**FE-обработка:** `extractApiError(err)` в `api/client.ts` разворачивает envelope и возвращает `{ userMessage, code }`. Все мутации вызывают `pushToast(userMessage, 'dg')` в `onError`.

---

## Section 6 — Adaptive Layout

### 6.1 Breakpoints

| Имя | Условие | Поведение |
|---|---|---|
| `mobile` | `< 768px` | TabBar внизу, одноколоночный контент |
| `tablet` | `768–1279px` | TabBar вертикально (sidebar) |
| `desktop` | `≥ 1280px` | TabBar вертикально (sidebar), широкие grid-сетки |

`useViewport()` hook: `window.matchMedia` listeners, обновляет `Breakpoint` state при ресайзе.

### 6.2 ScreenLayout

```
Mobile (< 768px):
┌──────────────────────────────────┐
│          TgHeader  50px          │
├──────────────────────────────────┤
│    Scrollable body               │
│    top: 50px + safe-area-top     │
│    bottom: 74px + safe-area-btm  │
├──────────────────────────────────┤
│      TabBar  74px                │
│    + safe-area-inset-bottom      │
└──────────────────────────────────┘

Tablet / Desktop (≥ 768px):
┌─────────────┬────────────────────┐
│   Sidebar   │     TgHeader       │
│  (TabBar    ├────────────────────┤
│  vertical)  │  Scrollable body   │
│             │  top: 50px+inset   │
│             │  bottom: 0         │
└─────────────┴────────────────────┘
```

**Ключевые детали:**
- `noScroll=true` (ReviewPage) — `overflow: hidden` в body, SwipeDeck занимает весь viewport
- `extraScrollPad`: mobile + tabbar → 24px; wide → 30px; noScroll → 0
- `TabBar` получает prop `orientation: 'horizontal' | 'vertical'` от SellerLayout/AdminLayout в зависимости от `useViewport()`

### 6.3 PageShell

`frontend/src/components/layout/PageShell.tsx` — legacy-обёртка; текущий routing использует `ScreenLayout` напрямую.

---

## Section 7 — Live Infra

### 7.1 Docker Compose Services

| Сервис | Image | Порты | ENV-переменные |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5432 | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` |
| `redis` | redis:7-alpine | 6379 | — |
| `minio` | minio/minio | 9000 (S3), 9001 (console) | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` |
| `createbuckets` | minio/mc | — | Создаёт `vliq-receipts` bucket, anonymous download |
| `backend` | ./backend | 8000 (internal) | `POSTGRES__POSTGRES_URL`, `REDIS_URL`, `S3_ENDPOINT_URL`, `RECEIPT_STORAGE=s3`, все из `.env` |
| `receipt-pipeline-worker` | ./backend | — | `POSTGRES__POSTGRES_URL`, `REDIS_URL`, `OFD_PROVIDER`, `OCR_MODE`, `OFD_RETRY_MAX_ATTEMPTS`, `OFD_TIMEOUT_SECONDS` |
| `notifications-worker` | ./backend | — | `POSTGRES__POSTGRES_URL` |
| `bot` | ./backend | 8081 (internal) | `POSTGRES__POSTGRES_URL`, `REDIS_URL`, `BOT_MODE`, `BOT_WEBHOOK_HOST`, `BOT_WEBHOOK_SECRET`, `TG_BOT_TOKEN` |
| `frontend` | ./frontend | 80 (internal) | — (build-time `VITE_*`) |
| `caddy` | caddy:2-alpine | 80, 443 | `CADDY_HOSTNAME`, `CADDY_TLS_DIRECTIVE`, `CADDY_EMAIL` |
| `prometheus` | prom/prometheus | 9090 (internal) | — (config: `ops/prometheus.yml`) |
| `loki` | grafana/loki:2.9.4 | 3100 (internal) | — |
| `promtail` | grafana/promtail:2.9.4 | — | Docker socket read (scrapes container logs) |
| `grafana` | grafana/grafana | 3000 | `GF_SECURITY_ADMIN_USER`, `GF_SECURITY_ADMIN_PASSWORD` |

**Backend startup command:**
```sh
alembic upgrade head && python -m src.scripts.seed_dev && uvicorn src.app.main:app --host 0.0.0.0 --port 8000
```

### 7.2 Quick Start

```sh
# Скопировать .env.example → .env, заполнить TG_BOT_TOKEN
docker compose up -d
# Frontend: http://localhost (через Caddy)
# MinIO console: http://localhost:9001
# Grafana: http://localhost:3000
```

### 7.3 Ключевые env-флаги

| Переменная | Значения | Эффект |
|---|---|---|
| `OCR_MODE` | `demo` (default) / `full` | demo → пропускает OCR/OFD, фиксированный бонус 250 |
| `OFD_PROVIDER` | `fake` (default) / `proverkacheka` | fake → canned data; proverkacheka → реальный API |
| `RECEIPT_STORAGE` | `local` / `s3` | s3 → MinIO presigned upload |
| `BOT_MODE` | `polling` (default) / `webhook` | webhook требует `BOT_WEBHOOK_HOST` + Caddyfile route |
| `OFD_RETRY_MAX_ATTEMPTS` | int (default 3) | Макс попыток OFD-запроса |
| `OFD_TIMEOUT_SECONDS` | float (default 10) | HTTP timeout на OFD |
| `PROVERKACHEKA_TOKEN` | string | API-токен proverkacheka.com |

---

## Section 8 — Recent Bugfix History (2026-05)

| Баг | Симптом | Фикс | Место |
|---|---|---|---|
| **409-trap (action gate)** | Повторный approve уже одобренного чека → 409 RECEIPT_INVALID_STATE_TRANSITION, неприятный toast в цикле | Кнопки «Одобрить/Доработка/Отклонить» рендерятся только если `receipt.status === 'on_review'`; для остальных показывается «Чек уже обработан» | `ReceiptDetailSheet.tsx:237` |
| **Dashboard counter ↔ review queue** | Счётчик «На проверке» на DashPage не совпадал с реальной длиной очереди | Счётчик теперь берётся из отдельного запроса `GET /receipts?status=on_review&limit=1` (total), а не агрегируется из общего списка | `useAdminDashboard` hook |
| **SwipeDeck undoTrigger** | Если admin открыл RejectReasonSheet и нажал «Отмена» — карточка исчезала из деки, хотя reject не выполнился | `handleRejectClose` инкрементирует `undoTrigger`, SwipeDeck получает его как prop и откатывает оптимистический advance | `ReviewPage.tsx:28,85` |
| **ProverkachekaClient payload t/s/qr fix** | Запрос к `proverkacheka.com` без полей `t` (время) и `s` (сумма) возвращал пустое тело → `JSONDecodeError` | Добавлены поля `t=YYYYMMDDTHHMM`, `s=<kopecks>`, `qr=0` в POST-форму | `proverkacheka.py:118-126` |
| **ProverkachekaClient code=5 not_found** | Код `5` в ответе трактовался как unknown → `OFDBlockedError` → pipeline падал | Добавлен `5` в `_NOT_FOUND_CODES = {2, 4, 5}` → правильный `OFDNotFoundError` → `needs_revision` | `proverkacheka.py:43` |
| **Android initData async wait** | На Android initData приходит через 200-1500 мс после paint; старый код не ждал → `error: outside Telegram` | `waitForInitData(2500)` + `isLikelyTmaContext()` в `useAuthFlow` | `useAuthFlow.ts:42-43` |
| **AuthGate openTelegramLink** | Кнопка «Открыть @bot» в error-state вызывала `window.open` что не работало внутри TG WebView | Приоритет `Telegram.WebApp.openTelegramLink(tmeUrl)` перед `window.open` | `AuthGate.tsx:55-58` |

---

## Section 9 — Known Gaps

### 9.1 Устаревшие unit-тесты

| Тест | Проблема |
|---|---|
| `test_business_process` | Тестирует старый синхронный пайплайн; не отражает текущий arq-worker + async orchestrator |
| `test_proverkacheka unexpected_code` | Ожидает `OFDBlockedError` для кода `5`, но после фикса код `5` теперь `OFDNotFoundError` |

### 9.2 Toast-only stubs (нет API-вызова)

| Кнопка | Экран | Предлагаемый endpoint |
|---|---|---|
| «Excel-выгрузка» | PayoutsPage | `GET /payout-requests/export?format=xlsx` |
| «Полноэкранный просмотр» (Zoom) | ReceiptDetailSheet | Локальный лайтбокс (FE-only, не требует BE) |
| (старая) «Изменить бонус» | ReceiptDetailSheet (устарел) | Реализован: `PATCH /receipts/:id/bonus` уже есть |
| (старая) «Комментарий» | ReceiptDetailSheet (устарел) | Реализован: `POST /receipts/:id/comment` уже есть |

> Примечание: «Изменить бонус» и «Комментарий» были toast-stubs по данным CONTRACT_AUDIT_2026-05. По USERCASES_2026-05 они уже реализованы. Проверить актуальное состояние кода.

### 9.3 21 BE-stub (501 NOT_IMPLEMENTED)

Все стабы скрыты от FE — нет потребителей. Группы:

- `POST/GET/PATCH/DELETE /admins` — нет возможности управлять администраторами через API
- `POST/GET/PATCH/DELETE /brands` — нет управления брендами
- `GET/POST/PATCH/DELETE /skus` — нет управления каталогом SKU
- `POST/PATCH/DELETE /promotions` — акции только читаются, не создаются
- `POST/PATCH/DELETE /notifications` — уведомления только читаются
- `POST /bonus-transactions` — бонусы только создаются через pipeline
- `PATCH/DELETE /payout-requests/:id` — нет редактирования заявок
- `POST /audit-logs` — аудит-лог только читается

### 9.4 13 Dead BE endpoints (нет FE-потребителя)

`GET /auth/info`, `POST /sellers/tg-upsert`, `GET /payout-requests/:id`, `POST /receipts/:id/retry`, `POST /receipts` (manual create), `PATCH /receipts/:id`, `DELETE /receipts/:id`, `GET /receipts/:id` (admin individual), `GET /notifications/:id`, `GET /bonus-transactions/:id`, `GET /audit-logs`, `GET /audit-logs/:id`, `GET /sellers/me/notifications` (superseded by `/notifications`).

### 9.5 Функциональные TODO в коде

| Место | TODO |
|---|---|
| `PayoutPage.tsx:38` | `noFlag = true` — антифрод-сигнал всегда «нет» пока BE не отдаст реальный флаг |
| `PayoutDetailSheet.tsx:59` | Антифрод-баннер всегда зелёный — hardcoded «подозрительной активности нет» |
| `ProfilePage.tsx:13` | `ADMIN_SUPPORT_USERNAME = 'vliq_support'` — хардкод, нужно получать с BE |
| `SellerDetailSheet.tsx` | `receipts_approved` всегда `undefined` — BE не возвращает это поле |
| `SellersPage.tsx` | `search` параметр передаётся но BE его игнорирует (`GET /sellers` не реализует поиск) |
| `PayoutsPage.tsx` | `search` в `AdminPayoutsFilters` игнорируется BE |

---

*Документ сгенерирован на основе прямого чтения исходного кода. Дата актуальности: 2026-05.*
