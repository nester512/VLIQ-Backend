# Handover: admin «Продавцы» + server-side dashboard (branch `feat/admin-sellers-workspace`)

## Задача (от владельца продукта, 2026-10-08)
1. В разделе «Продавцы» невозможно найти нужного: нет фильтров, сортировок, бесконечного скролла, видны только первые 50.
2. Нужны логичные интерфейсы; сортировка/фильтрация по **популярности** и **частоте** продавца.
3. Внутри продавца нет статистики → добавить статистику, **фактор риска** и **историю чеков**.
4. Из чека можно перейти в продавца и посмотреть его предыдущие чеки.
5. Метрики главной (дашборд) неверны на больших данных → считать на сервере.
6. Раздуть тестовую базу стенда, чтобы это увидеть и проверить (сделано, см. ниже).

## Критерии готовности (проверять на стенде https://test-nekuro.online, ветка develop → автодеплой)
- [x] Список продавцов: поиск (debounce) по имени/телефону/точке/городу/telegram_id; фильтры статус (все/активные/ожидают/блок) и риск (низкий/средний/высокий), «есть чеки на проверке»; сортировки: новые, последняя активность, популярность (receipts_total), частота (receipts_30d), риск; бесконечный скролл через все 2000+ продавцов; в строке — кол-во чеков, частота за 30 дн., пилюля риска; общее число найденных.
- [x] Карточка/страница продавца: баланс, начислено, выплачено, на удержании, средний бонус, чеки по статусам, частота, первый/последний чек, риск (score + level + причины flags), активность по неделям (12 нед.), действия блок/разблок через `POST /sellers/{id}/block|unblock` (с уведомлением, а не PATCH).
- [x] История чеков продавца: ВСЕ статусы с фильтром, новые сверху (`GET /receipts?seller_id=&order=desc`), бесконечный скролл.
- [x] Из чека (ReceiptDetailSheet, ReceiptInfoCard, финальная карточка SwipeDeck) — переход на страницу продавца `/admin/sellers/:telegramId/receipts` (не замена шторки без возврата).
- [x] Дашборд берёт `GET /analytics/dashboard`; цифры совпадают с SQL на стенде (сверить запросами к БД стенда).
- [x] Тесты: backend unit + PG-интеграция для новых агрегатов/сортировок/фильтров; frontend vitest на страницы/хуки; ruff 0.12.12, tsc, eslint зелёные; CI зелёный.
- [x] PR в develop → проверено на стенде (API + скриншоты/описание UI) → отчёт владельцу. В main не мержить без явного «да».

## Статус (2026-10-08)
Реализовано и влито в `develop` (стенд). Backend: `GET /analytics/dashboard` (`src/analytics/service.py`),
статистика/риск/сортировки/фильтры продавцов, `GET /receipts?order=desc`. Frontend: список продавцов
(поиск с debounce, фильтры статус/риск/«есть на проверке», 5 сортировок, бесконечный скролл, фильтры в URL),
страница продавца `/admin/sellers/:id/receipts` (баланс, начислено/выплачено/удержание, средний бонус,
чеки по статусам, частота, первый/последний чек, риск + причины, 12 недель активности, блок/разблок через
POST, история всех чеков с фильтром и скроллом), переход к продавцу из ReceiptDetailSheet / ReceiptInfoCard /
финальной карточки SwipeDeck, дашборд одним запросом.

Тесты: backend unit (`tests/seller/test_list_sellers.py`, `test_stats_service.py`, `tests/analytics/`),
PG (`tests/integration/pg/test_seller_list_stats_pg.py`, `test_admin_dashboard_pg.py`); frontend
`SellersPage.test.tsx`, `SellerReceiptsPage.test.tsx`, `useAdminDashboard.test.ts`, `useLoadMoreSentinel.test.ts`,
`api/admin.test.ts`, `SwipeDeck.test.tsx`, `ReceiptDetailSheet.test.tsx`.

### Требует решения продукта
- **Формула риска** — эвристика, константы вверху `backend/src/seller/services/stats_service.py`
  (`W_REJECT=0.5`, `W_DUPLICATE=0.5`, пороги `RISK_MEDIUM=20`, `RISK_HIGH=45`, `RISK_MIN_DECISIONS=5`).
- **«Выплачено за месяц»** считается по `payout_request.updated_at` (момент перевода в `paid`): отдельного
  `paid_at` нет, поэтому позднее редактирование выплаченной заявки сдвинет её в текущий месяц.
- Даты дашборда/недель — в часовом поясе сессии БД (на стенде UTC), не в МСК.

## Как проверять (см. также CLAUDE.md)
- Тестовый образ backend: `vliq-backend-dev` (python 3.12 + poetry deps, собран из `backend/pyproject.toml`). Unit:
  `docker run --rm -v $HOME/work/VLIQ-Backend/backend:/work -w /work -e PYTHONDONTWRITEBYTECODE=1 -e JWT_SECRET_SALT=ci-only-jwt-secret -e TG_BOT_TOKEN=1:ci-only-token -e POSTGRES__POSTGRES_URL=postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq_test -e RECEIPT_STORAGE=local vliq-backend-dev sh -c 'ruff check src tests && python -m pytest --ignore=tests/integration --ignore=tests/migrations -q -p no:cacheprovider'`
- PG-тесты: временный `postgres:16-alpine` в отдельной docker-сети, `TEST_PG_URL` на него, `pytest tests/migrations tests/integration/pg`.
- Frontend: `docker run --rm -v $HOME/work/VLIQ-Backend/frontend:/app -w /app node:22-alpine sh -c 'npm ci && npx tsc -b && npx vitest run && npm run lint'`.
- Стенд: деплой = merge в `develop` (CI → `Deploy / stage`). Токены для API-проверок — реальный `POST /auth/tma-verify`, initData подписывается токеном стенд-бота ВНУТРИ контейнера `vliq-backend` (скрипт-образец: подписать `auth_date,query_id,user` по спецификации Telegram). Аудит-аккаунты: продавцы `70000001`, `70000002`; админы `70000091`, `70000092`.
- Грабли: чтение через request-scoped сессию автоначинает транзакцию → последующий `async with session.begin()` падает (см. `seller/depends.py::forbid_blocked_seller`). Мок-тесты этого не ловят — нужен PG-тест.
