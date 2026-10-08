# Handover: admin «Продавцы» + server-side dashboard (WIP, branch `feat/admin-sellers-workspace`)

## Задача (от владельца продукта, 2026-10-08)
1. В разделе «Продавцы» невозможно найти нужного: нет фильтров, сортировок, бесконечного скролла, видны только первые 50.
2. Нужны логичные интерфейсы; сортировка/фильтрация по **популярности** и **частоте** продавца.
3. Внутри продавца нет статистики → добавить статистику, **фактор риска** и **историю чеков**.
4. Из чека можно перейти в продавца и посмотреть его предыдущие чеки.
5. Метрики главной (дашборд) неверны на больших данных → считать на сервере.
6. Раздуть тестовую базу стенда, чтобы это увидеть и проверить (сделано, см. ниже).

## Критерии готовности (проверять на стенде https://test-nekuro.online, ветка develop → автодеплой)
- [ ] Список продавцов: поиск (debounce) по имени/телефону/точке/городу/telegram_id; фильтры статус (все/активные/ожидают/блок) и риск (низкий/средний/высокий), «есть чеки на проверке»; сортировки: новые, последняя активность, популярность (receipts_total), частота (receipts_30d), риск; бесконечный скролл через все 2000+ продавцов; в строке — кол-во чеков, частота за 30 дн., пилюля риска; общее число найденных.
- [ ] Карточка/страница продавца: баланс, начислено, выплачено, на удержании, средний бонус, чеки по статусам, частота, первый/последний чек, риск (score + level + причины flags), активность по неделям (12 нед.), действия блок/разблок через `POST /sellers/{id}/block|unblock` (с уведомлением, а не PATCH).
- [ ] История чеков продавца: ВСЕ статусы с фильтром, новые сверху (`GET /receipts?seller_id=&order=desc`), бесконечный скролл.
- [ ] Из чека (ReceiptDetailSheet, ReceiptInfoCard, финальная карточка SwipeDeck) — переход на страницу продавца `/admin/sellers/:telegramId/receipts` (не замена шторки без возврата).
- [ ] Дашборд берёт `GET /analytics/dashboard`; цифры совпадают с SQL на стенде (сверить запросами к БД стенда).
- [ ] Тесты: backend unit + PG-интеграция для новых агрегатов/сортировок/фильтров; frontend vitest на страницы/хуки; ruff 0.12.12, tsc, eslint зелёные; CI зелёный.
- [ ] PR в develop → проверено на стенде (API + скриншоты/описание UI) → отчёт владельцу. В main не мержить без явного «да».

## Что уже сделано в ветке (WIP-коммит)
- `ops/seed_load_stage.sql` — синтетическая нагрузка ТОЛЬКО для стенда (2000 продавцов, ~75k чеков, ~1.6k выплат, id ≥ 9e12, идемпотентно, требует `-v confirm=stage`). **Уже применён на БД стенда.**
- `backend/src/seller/services/stats_service.py` — агрегаты по чекам в SQL, формула риска (константы вверху файла — эвристика, требует подтверждения продукта), недельная активность, средний бонус.
- `backend/src/seller/schemas/api.py` — `SellerStats`, `SellerWeekActivity`, `SellerListItem`; `SellerReadAdmin` расширен (stats, total_accrued, total_paid_out, on_hold, avg_bonus, weekly_activity).
- `backend/src/seller/handlers/api/v1/router.py` — `GET /sellers` → `PagedResponse[SellerListItem]`, сортировки `created_at|updated_at|last_receipt_at|receipts_total|receipts_30d|receipts_approved|risk_score|name` (`field:dir`), фильтры `status, city, risk, has_on_review, search`; `GET /sellers/{id}` со статистикой. Прототип агрегата на 75k чеков — 43 мс.
- `backend/src/receipt/handlers/api/v1/router.py` — `GET /receipts?order=asc|desc` (по умолчанию asc = очередь FIFO не меняется).
- `backend/src/analytics/schemas/api.py` — схема `AdminDashboard`.

## Что осталось
1. `backend/src/analytics/service.py` + `handlers/api/v1/router.py` (`prefix="/analytics"`, `GET /dashboard`, `require_admin`) и регистрация в `backend/src/app/api/v1.py`. Метрики — см. `AdminDashboard`; paid за месяц — `status='paid' AND updated_at >= date_trunc('month', now())`; daily — `generate_series` за 30 дней с нулями; top_sellers — по approved desc, total desc, 25 шт., sales = Σ total_sum approved, paid = Σ paid payouts; top_products — `jsonb_array_elements(items)` по approved, 15 шт.
2. Тесты backend (мок + PG в `tests/integration/pg/`), включая сортировки/фильтры/риск и дашборд.
3. Frontend (`frontend/src`):
   - `api/admin.ts`: типы `stats`, параметры sort/risk/city/has_on_review; **исправить баг `mapAdminSeller`** (выбрасывает `balance_available`/`receipts_total` → «—» в карточке); `getAdminDashboard()`; `getAdminReceipts` с `order`.
   - `features/admin/pages/SellersPage.tsx`: `useInfiniteQuery` (образец `features/seller/hooks/useReceipts.ts` + `HistoryPage.tsx` с IntersectionObserver), debounce поиска, `FilterPills` для статуса и риска, селектор сортировки, total.
   - `features/admin/pages/SellerReceiptsPage.tsx` → полноценная страница продавца: шапка со статистикой и риском + история всех чеков с фильтром и бесконечным скроллом.
   - `features/admin/sheets/SellerDetailSheet.tsx`: статистика/риск; блок через POST block/unblock (`blockSeller`/`unblockSeller` в `api/admin.ts`).
   - Переход из чека к продавцу: `ReceiptDetailSheet.tsx` (кнопка «К продавцу» → navigate на страницу продавца), `ReceiptInfoCard.tsx` (имя продавца кликабельно).
   - `features/admin/hooks/useAdminDashboard.ts` → один запрос `GET /analytics/dashboard`; сохранить форму `DashboardData` для `DashPage.tsx` (A4: состав метрик не расширяем, только корректность).
   - Обновить тесты: `useAdminDashboard.test.ts`, `DashPage.test.tsx`, `AdminReceiptsPage.test.tsx`; добавить тесты SellersPage/SellerReceiptsPage.

## Как проверять (см. также CLAUDE.md)
- Тестовый образ backend: `vliq-backend-dev` (python 3.12 + poetry deps, собран из `backend/pyproject.toml`). Unit:
  `docker run --rm -v $HOME/work/VLIQ-Backend/backend:/work -w /work -e PYTHONDONTWRITEBYTECODE=1 -e JWT_SECRET_SALT=ci-only-jwt-secret -e TG_BOT_TOKEN=1:ci-only-token -e POSTGRES__POSTGRES_URL=postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq_test -e RECEIPT_STORAGE=local vliq-backend-dev sh -c 'ruff check src tests && python -m pytest --ignore=tests/integration --ignore=tests/migrations -q -p no:cacheprovider'`
- PG-тесты: временный `postgres:16-alpine` в отдельной docker-сети, `TEST_PG_URL` на него, `pytest tests/migrations tests/integration/pg`.
- Frontend: `docker run --rm -v $HOME/work/VLIQ-Backend/frontend:/app -w /app node:22-alpine sh -c 'npm ci && npx tsc -b && npx vitest run && npm run lint'`.
- Стенд: деплой = merge в `develop` (CI → `Deploy / stage`). Токены для API-проверок — реальный `POST /auth/tma-verify`, initData подписывается токеном стенд-бота ВНУТРИ контейнера `vliq-backend` (скрипт-образец: подписать `auth_date,query_id,user` по спецификации Telegram). Аудит-аккаунты: продавцы `70000001`, `70000002`; админы `70000091`, `70000092`.
- Грабли: чтение через request-scoped сессию автоначинает транзакцию → последующий `async with session.begin()` падает (см. `seller/depends.py::forbid_blocked_seller`). Мок-тесты этого не ловят — нужен PG-тест.
