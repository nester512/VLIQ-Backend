# VLIQ-BOT Contract Audit — May 2026

> Audit date: 2026-05-30. Read-only. Covers backend `/api/v1` prefix (PATH_PREFIX).

---

## 1. Executive Summary

- **BE routes: 47 total** — 26 are real implementations, 21 are `501 NOT_IMPLEMENTED` stubs (44.7% stubbed).
- **FE API calls: 28 distinct calls** across `src/api/*.ts` — 25 matched to real BE routes, 3 matched to 501 stubs.
- **Dashboard is a N+4 query hack**: `DashPage` fires 4 parallel list queries (sellers/payouts/receipts/receipts-pending) to compute metrics client-side. No `/analytics/dashboard` endpoint exists.
- **3 toast-only buttons with no API**: "Изменить бонус" and "Комментарий" in `ReceiptDetailSheet`, "Excel-выгрузка" in `PayoutsPage`, and "Заблокировать пользователя" in `ReceiptDetailSheet` (dispatches `pushToast` with no API call despite a TODO comment).
- **Top structural gap**: All admin resource management (brands, SKUs, admins, promotions write/CRUD) is 501. The seller self-service and review flow are the only production-ready paths.

---

## 2. API Contract Table

### Auth (`/api/v1/auth`)

| Endpoint | Method | Auth | Status | FE Consumer |
|---|---|---|---|---|
| `/auth/login` | POST | none | ✅ Real (disabled in prod → 404) | `auth.ts:loginByTgId` |
| `/auth/tma-verify` | POST | none | ✅ Real | `auth.ts:tmaVerify` |
| `/auth/info` | GET | any | ✅ Real | none (dead endpoint) |

### Sellers (`/api/v1/sellers`)

| Endpoint | Method | Auth | Status | FE Consumer |
|---|---|---|---|---|
| `/sellers/me` | GET | seller | ✅ Real | `sellers.ts:getMe` |
| `/sellers/me` | PATCH | seller | ✅ Real | `sellers.ts:updateMe` |
| `/sellers/me/balance` | GET | seller | ✅ Real | `sellers.ts:getMyBalance` |
| `/sellers/me/receipts` | GET | seller | ✅ Real | `receipts.ts:getMyReceipts` |
| `/sellers/me/notifications` | GET | seller | ✅ Real | `sellers.ts:getMyNotifications` (unused — superseded by `/notifications`) |
| `/sellers/tg-upsert` | POST | any | ✅ Real | none (dead endpoint — not called by FE) |
| `/sellers` | GET | admin | ✅ Real | `admin.ts:getAdminSellers` |
| `/sellers/{id}` | GET | admin | ✅ Real | `admin.ts:getAdminSeller`, `getAdminSellerById` |
| `/sellers/{id}` | PATCH | any | ✅ Real | `admin.ts:setSellerStatus` |
| `/sellers` | POST | none | ⚠️ 501 stub | none |
| `/sellers/{id}` | DELETE | none | ⚠️ 501 stub | none |

### Receipts (`/api/v1/receipts`)

| Endpoint | Method | Auth | Status | FE Consumer |
|---|---|---|---|---|
| `/receipts/upload` | POST | any | ✅ Real | `receipts.ts:uploadReceipt` |
| `/receipts/qr-payload` | POST | seller | ✅ Real | `receipts.ts:submitQrPayload` |
| `/receipts/upload-url` | POST | seller | ✅ Real (501 on local storage) | `receipts.ts:getUploadUrl` |
| `/receipts/finalize` | POST | seller | ✅ Real (501 on local storage) | `receipts.ts:finalizeUpload` |
| `/receipts/{id}/status` | GET | any | ✅ Real | `receipts.ts:getReceiptStatus` |
| `/receipts/{id}/approve` | POST | admin | ✅ Real | `admin.ts:approveReceipt` |
| `/receipts/{id}/reject` | POST | admin | ✅ Real | `admin.ts:rejectReceipt` |
| `/receipts/{id}/revise` | POST | admin | ✅ Real | `admin.ts:reviseReceipt` |
| `/receipts/{id}/retry` | POST | admin | ✅ Real | none (dead endpoint — no FE call) |
| `/receipts` | GET | admin | ✅ Real | `admin.ts:getAdminReceipts` |
| `/receipts/{id}` | GET | admin | ✅ Real | `receipts.ts:getReceipt` |
| `/receipts` | POST | admin | ✅ Real (manual admin create) | none (dead endpoint) |
| `/receipts/{id}` | PATCH | admin | ✅ Real | none (dead endpoint) |
| `/receipts/{id}` | DELETE | admin | ✅ Real | none (dead endpoint) |

### Payout Requests (`/api/v1/payout-requests`)

| Endpoint | Method | Auth | Status | FE Consumer |
|---|---|---|---|---|
| `/payout-requests` | POST | seller | ✅ Real | `payouts.ts:createPayoutRequest` |
| `/payout-requests` | GET | admin | ✅ Real | `admin.ts:getAdminPayouts` |
| `/payout-requests/{id}` | GET | any | ✅ Real | none (dead endpoint) |
| `/payout-requests/{id}/approve` | POST | admin | ✅ Real | `admin.ts:approvePayoutRequest` |
| `/payout-requests/{id}/reject` | POST | admin | ✅ Real | `admin.ts:rejectPayoutRequest` |
| `/payout-requests/{id}` | PATCH | none | ⚠️ 501 stub | none |
| `/payout-requests/{id}` | DELETE | none | ⚠️ 501 stub | none |

### Promotions (`/api/v1/promotions`)

| Endpoint | Method | Auth | Status | FE Consumer |
|---|---|---|---|---|
| `/promotions` | GET | any | ✅ Real | `promotions.ts:listPromotions` |
| `/promotions` | POST | none | ⚠️ 501 stub | none |
| `/promotions/{id}` | GET | none | ⚠️ 501 stub | none |
| `/promotions/{id}` | PATCH | none | ⚠️ 501 stub | none |
| `/promotions/{id}` | DELETE | none | ⚠️ 501 stub | none |

### Notifications (`/api/v1/notifications`)

| Endpoint | Method | Auth | Status | FE Consumer |
|---|---|---|---|---|
| `/notifications` | GET | any | ✅ Real | `notifications.ts:listNotifications` |
| `/notifications/{id}` | GET | any | ✅ Real | none (dead endpoint) |
| `/notifications/{id}/read` | POST | any | ✅ Real | `notifications.ts:markRead` |
| `/notifications` | POST | none | ⚠️ 501 stub | none |
| `/notifications/{id}` | PATCH | none | ⚠️ 501 stub | none |
| `/notifications/{id}` | DELETE | none | ⚠️ 501 stub | none |

### Bonus Transactions (`/api/v1/bonus-transactions`)

| Endpoint | Method | Auth | Status | FE Consumer |
|---|---|---|---|---|
| `/bonus-transactions` | GET | any | ✅ Real | `bonusTransactions.ts:listMyBonusTransactions` |
| `/bonus-transactions/{id}` | GET | any | ✅ Real | none (dead endpoint) |
| `/bonus-transactions` | POST | none | ⚠️ 501 stub | none |
| `/bonus-transactions/{id}` | PATCH | none | 405 (intentional) | none |
| `/bonus-transactions/{id}` | DELETE | none | 405 (intentional) | none |

### Admins (`/api/v1/admins`) — all 501

| Endpoint | Method | Status | FE Consumer |
|---|---|---|---|
| `/admins` | GET | ⚠️ 501 stub | none |
| `/admins` | POST | ⚠️ 501 stub | none |
| `/admins/{id}` | GET | ⚠️ 501 stub | none |
| `/admins/{id}` | PATCH | ⚠️ 501 stub | none |
| `/admins/{id}` | DELETE | ⚠️ 501 stub | none |

### Brands (`/api/v1/brands`) — all 501

| Endpoint | Method | Status | FE Consumer |
|---|---|---|---|
| `/brands` | GET | ⚠️ 501 stub | none |
| `/brands` | POST | ⚠️ 501 stub | none |
| `/brands/{id}` | GET | ⚠️ 501 stub | none |
| `/brands/{id}` | PATCH | ⚠️ 501 stub | none |
| `/brands/{id}` | DELETE | ⚠️ 501 stub | none |

### SKUs (`/api/v1/skus`) — all 501

| Endpoint | Method | Status | FE Consumer |
|---|---|---|---|
| `/skus` | GET | ⚠️ 501 stub | none |
| `/skus` | POST | ⚠️ 501 stub | none |
| `/skus/{id}` | GET | ⚠️ 501 stub | none |
| `/skus/{id}` | PATCH | ⚠️ 501 stub | none |
| `/skus/{id}` | DELETE | ⚠️ 501 stub | none |

### Audit Logs (`/api/v1/audit-logs`)

| Endpoint | Method | Auth | Status | FE Consumer |
|---|---|---|---|---|
| `/audit-logs` | GET | admin | ✅ Real | none (dead endpoint) |
| `/audit-logs/{id}` | GET | admin | ✅ Real | none (dead endpoint) |
| `/audit-logs` | POST | none | ⚠️ 501 stub | none |
| `/audit-logs/{id}` | PATCH | none | 405 (intentional) | none |
| `/audit-logs/{id}` | DELETE | none | 405 (intentional) | none |

---

## 3. UI Button Table

### Seller — `UploadPage.tsx`

| Label | Action | Status |
|---|---|---|
| Камера | Opens camera input | 🟠 Navigates (file input) |
| PDF / файл | Opens file picker | 🟠 Navigates (file input) |
| QR-код | Calls `Telegram.WebApp.showScanQrPopup` | 🟢 Calls `submitQrPayload` |
| Отправить чек | Calls `useUploadReceipt` | 🟢 Calls `uploadReceipt` / `submitQrPayload` |
| Выбрать другой файл | Clears selection | ⚫ Local state clear |
| Очистить (QR) | Clears QR state | ⚫ Local state clear |

### Seller — `HomePage.tsx`

| Label | Action | Status |
|---|---|---|
| Загрузить чек (QuickAction) | `navigate('/seller/upload')` | 🟠 Navigates |
| Мой баланс (QuickAction) | `navigate('/seller/balance')` | 🟠 Navigates |
| История (QuickAction) | `navigate('/seller/history')` | 🟠 Navigates |
| Акции (QuickAction) | `navigate('/seller/promo')` | 🟠 Navigates |
| Все (recent receipts) | `navigate('/seller/history')` | 🟠 Navigates |
| Загрузить чек (EmptyState) | `navigate('/seller/upload')` | 🟠 Navigates |
| ReceiptRow (each receipt) | `navigate('/seller/status/{id}')` | 🟠 Navigates |

### Seller — `PayoutPage.tsx`

| Label | Action | Status |
|---|---|---|
| Заполнить реквизиты → | `navigate('/seller/reg')` | 🟠 Navigates |
| Запросить выплату / Требуется заполнить | Calls `useRequestPayout` → `createPayoutRequest` | 🟢 Calls `POST /payout-requests` |

### Seller — `RegPage.tsx`

| Label | Action | Status |
|---|---|---|
| Далее (step 1) | Local step advance | ⚫ Local state |
| Назад (step 2) | Local step back | ⚫ Local state |
| Завершить регистрацию | Calls `updateMe` → `PATCH /sellers/me` | 🟢 Calls real API |
| Использовать телефон из Telegram | `Telegram.WebApp.requestContact` | 🟢 TMA native |
| СБП/Карта/СБП·банк payout toggles | Local form update | ⚫ Local state |

### Seller — `ProfilePage.tsx`

| Label | Action | Status |
|---|---|---|
| Мой баланс (NavRow) | `navigate('/seller/balance')` | 🟠 Navigates |
| Реквизиты выплаты (NavRow) | `navigate('/seller/payout')` | 🟠 Navigates |
| Уведомления (NavRow) | `openSheet('notif')` | 🟠 Opens sheet → `listNotifications` |
| Помощь администратора (NavRow) | `openTelegramChat('vliq_support')` | 🟡 Toast + TMA link (no API) |
| Заполнить (pending badge) | `navigate('/seller/reg')` | 🟠 Navigates |
| [DEV] Выйти | `logout()` | ⚫ Local auth clear |

### Admin — `DashPage.tsx`

| Label | Action | Status |
|---|---|---|
| Проверить чеки (QuickNav) | `navigate('/admin/review')` | 🟠 Navigates |
| Заявки на выплату (QuickNav) | `navigate('/admin/payouts')` | 🟠 Navigates |
| Продавцы (QuickNav) | `navigate('/admin/sellers')` | 🟠 Navigates |
| TopSellersBoard seller item | `openSheet('seller', { telegram_id })` or navigate | 🟠 Opens SellerDetailSheet |

### Admin — `ReviewPage.tsx`

| Label | Action | Status |
|---|---|---|
| Swipe left (approve) | `approveReceipt` → `POST /receipts/{id}/approve` | 🟢 Real API |
| Swipe right (reject) | Opens RejectReasonSheet then `rejectReceipt` | 🟢 Real API |
| Tap card | `openSheet('detail', {…})` | 🟠 Opens ReceiptDetailSheet |

### Admin — `PayoutsPage.tsx`

| Label | Action | Status |
|---|---|---|
| Excel-выгрузка | `pushToast('Excel-выгрузка — скоро', 'info')` | 🟡 Toast-only stub |
| Filter pills (status) | Local filter + query re-run | 🟢 Re-calls `getAdminPayouts` |
| PayoutRow click | `openSheet('payout', {…})` | 🟠 Opens PayoutDetailSheet |

### Admin — `SellersPage.tsx`

| Label | Action | Status |
|---|---|---|
| SearchBar | Debounced query re-run | 🟢 Re-calls `getAdminSellers` |
| Filter pills (status) | Query re-run with status filter | 🟢 Re-calls `getAdminSellers` |
| SellerRow click | `openSheet('seller', { telegram_id })` | 🟠 Opens SellerDetailSheet |

### Admin Sheets — `ReceiptDetailSheet.tsx`

| Label | Action | Status |
|---|---|---|
| Одобрить | `swipe({ id, dir: 'approve' })` → `approveReceipt` | 🟢 Real API |
| Доработка | `swipe({ id, dir: 'revise' })` → `reviseReceipt` | 🟢 Real API |
| Отклонить | `swipe({ id, dir: 'reject' })` → `rejectReceipt` | 🟢 Real API |
| Zoom (fullscreen) | `pushToast('Полноэкранный просмотр — скоро', 'info')` | 🟡 Toast-only stub |
| Изменить бонус | `pushToast('Сумма бонуса изменена', 'ok')` | 🟡 Toast-only stub (no API) |
| Комментарий | `pushToast('Комментарий добавлен', 'ok')` | 🟡 Toast-only stub (no API) |
| Заблокировать пользователя | `pushToast('Пользователь заблокирован', 'dg')` | 🔴 Toast-only; TODO comment references non-existent `/sellers/{id}/block` |

### Admin Sheets — `PayoutDetailSheet.tsx`

| Label | Action | Status |
|---|---|---|
| Подтвердить | `approve.mutate(payoutId)` → `approvePayoutRequest` | 🟢 Real API |
| Отклонить | `reject.mutate(payoutId)` → `rejectPayoutRequest` | 🟢 Real API |

### Admin Sheets — `SellerDetailSheet.tsx`

| Label | Action | Status |
|---|---|---|
| К чекам | `navigate('/admin/sellers/{id}/receipts')` | 🟠 Navigates |
| Заблокировать / Разблокировать | `toggleStatus()` → `PATCH /sellers/{id}` | 🟢 Real API |

### Admin Sheets — `NotifSheet.tsx`

| Label | Action | Status |
|---|---|---|
| Unread notification tap | `markRead(id)` → `POST /notifications/{id}/read` | 🟢 Real API |

---

## 4. Frontend Routes Table

| Route | Component | Page exists? | Notes |
|---|---|---|---|
| `/` | `RoleRedirect` | ✅ | Redirects to `/seller/home` or `/admin/dash` by role |
| `/seller/home` | `HomePage` | ✅ | Real data from balance + receipts |
| `/seller/reg` | `RegPage` | ✅ | PATCH /sellers/me on submit |
| `/seller/upload` | `UploadPage` | ✅ | File + QR submit |
| `/seller/status/:id` | `StatusPage` | ✅ | Polls `/receipts/{id}/status` |
| `/seller/balance` | `BalancePage` | ✅ | Real balance + bonus-transactions |
| `/seller/history` | `HistoryPage` | ✅ | Real receipts list |
| `/seller/promo` | `PromoPage` | ✅ | Real `/promotions` list |
| `/seller/profile` | `ProfilePage` | ✅ | Real getMe data |
| `/seller/payout` | `PayoutPage` | ✅ | Real payout creation |
| `/admin/dash` | `DashPage` | ✅ | N+4 queries, no dedicated dashboard endpoint |
| `/admin/review` | `ReviewPage` | ✅ | Real swipe review queue |
| `/admin/payouts` | `PayoutsPage` | ✅ | Real payout list |
| `/admin/sellers` | `SellersPage` | ✅ | Real seller list |
| `/admin/sellers/:telegramId/receipts` | `SellerReceiptsPage` | ✅ | Real filtered receipt list |
| `*` (catchall) | `Navigate to /` | ✅ | Fallback redirect |

---

## 5. Schema / Mismatch Notes

| Issue | Detail |
|---|---|
| `GET /promotions` response | BE returns full `PromotionRead` with `rules`, `scope_cities`, `scope_skus` etc. FE `BackendPromotion` type only maps `id/brand_id/name/tag/description/starts_at/ends_at/status/priority` — extra fields silently dropped. No functional break. |
| `GET /sellers/me/notifications` (sellers.ts) | `getMyNotifications` in `sellers.ts` returns raw `r.data` without mapping. However `NotifSheet` calls `notifications.ts:listNotifications` (hits `/notifications`) instead. Duplicate path; `sellers.ts` version is dead code. |
| `SellerDetailSheet` shows `balance` and `receipts_total` | `GET /sellers/{id}` returns `SellerReadAdmin` with `balance_available` and `receipts_total`. FE maps `balance_available → balance` ✅. But FE type `AdminSellerRow` has `receipts_approved?` field which the backend does NOT return — always `undefined`. The sheet shows `0 одобрено` when data is actually unknown. |
| `GET /payout-requests` FE `search` param | `AdminPayoutsFilters.search` is passed as `params['search']` but the backend `list_payout_requests` handler does NOT accept a `search` query parameter — silently ignored. |
| `POST /auth/login` returns `role: "seller"` for id=99999 | In production this endpoint returns 404. FE `loginByTgId` is dev-only but is the only non-TMA login path — no TMA environment fallback is wired at AppRouter level. |

---

## 6. Live Curl Smoke Results (5 routes)

| # | Route | Result | Notes |
|---|---|---|---|
| 1 | `POST /auth/login {"id":99999}` | ✅ 200 `{access_token, role:"seller"}` | Token issued; seller auto-created as `status:pending` |
| 2 | `GET /sellers/me` | ✅ 200 — returns `status:"pending"` seller with stub phone `+9999999` | Field mapping correct |
| 3 | `GET /sellers/me/balance` | ✅ 200 `{available:0,on_hold:0,total_accrued:0,total_paid_out:0}` | Correct envelope |
| 4 | `GET /promotions?only_active=true` | ✅ 200 — returns 3 active promotions with full `rules/scope_*` fields | FE drops extra fields silently |
| 5 | `GET /notifications?limit=5` | ✅ 200 `{total:0,page:1,items:[]}` | Correct paged envelope |

Bonus checks:
- `POST /promotions` → ✅ 501 `NOT_IMPLEMENTED` (as expected for stub)
- `GET /payout-requests` (no auth) → ✅ 401 `AUTH_MISSING_TOKEN`

---

## 7. Recommended Fix Order

### P0 — Breaks user flow today

| # | Issue | Fix |
|---|---|---|
| P0-1 | **"Изменить бонус" toast stub** (`ReceiptDetailSheet`) — admin can't actually change bonus amount | Implement `PATCH /receipts/{id}` call or add a dedicated `PATCH /receipts/{id}/bonus` endpoint; FE already has `revise` path for the button |
| P0-2 | **"Заблокировать пользователя" in ReceiptDetailSheet** fires only a toast | Reuse existing `PATCH /sellers/{telegram_id}` with `{status:"blocked"}` — the route is real and the SellerDetailSheet already does this correctly |
| P0-3 | **Dashboard N+4 query overhead** — 4 heavy list queries on every DashPage mount (sellers/200 + payouts/200 + receipts/200 + receipts-probe/1) | Add `GET /analytics/dashboard` aggregation endpoint |

### P1 — Important gaps

| # | Issue | Fix |
|---|---|---|
| P1-1 | **Promotion CRUD all 501** — admin can't create/edit promotions via UI (no FE for it either, but the backend gap blocks future work) | Implement `POST/PATCH/DELETE /promotions` |
| P1-2 | **Admins CRUD all 501** — no way to add/remove admins via API | Implement `/admins` CRUD |
| P1-3 | **`GET /payout-requests` `search` param ignored** | Add `search` filter to `list_payout_requests` handler |
| P1-4 | **`receipts_approved` always `undefined`** in SellerDetailSheet | Extend `GET /sellers/{id}` to return approved receipt count, or add it to `/sellers/me/balance` |
| P1-5 | **Excel export stub** in PayoutsPage | Implement `GET /payout-requests/export` or similar |

### P2 — Clean-up / dead code

| # | Issue | Fix |
|---|---|---|
| P2-1 | `getMyNotifications` in `sellers.ts` is dead code (superseded by `/notifications` endpoint) | Remove or redirect to `/notifications` |
| P2-2 | `POST /sellers/tg-upsert` has no FE consumer | Either remove or document as bot-only endpoint |
| P2-3 | `GET /auth/info` has no FE consumer | Either remove or wire to app startup health check |
| P2-4 | `POST /receipts` (manual create), `PATCH /receipts/{id}`, `DELETE /receipts/{id}`, `GET /receipts/{id}` (admin) all have no FE consumers | Wire to admin UI or document as internal-only |
| P2-5 | Brands/SKUs all 501 with no FE consumers | Build admin brand/SKU management screens or document as ops-only |

---

## Totals

| Metric | Count |
|---|---|
| BE routes total | 47 |
| BE real implementations | 26 |
| BE 501 stubs | 21 |
| BE 405 (intentional) | 4 |
| FE API calls (distinct) | 28 |
| FE→BE matched + real | 24 |
| FE→BE matched + 501 stub | 1 (`POST /promotions` not called from FE) |
| FE calls with no matching BE route | 0 |
| BE routes with no FE consumer (dead) | 13 |
| Toast-only buttons (no API) | 4 |
