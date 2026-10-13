# VLIQ — контекст и правила для разработки (агенты и люди)

Актуально на 2026-10-13. Что это, где что живёт, как проверять и выкатывать, чего нельзя.
Конвенции кода — `backend/AGENTS.md`, `frontend/AGENTS.md` (часть статусов там устарела — сверяйся с кодом).

## Продукт и источники правды
Telegram Mini App «VLIQ»: продавцы отправляют кассовые чеки (данные QR) → админ проверяет вручную и
назначает бонус → продавец выводит деньги через СБП. Роли: seller, admin, super_admin.
- **Требования — `docs/use-cases/`**, порядок выпуска — `docs/process/RELEASE.md` (обзор + UC по интерфейсам, решения владельца, out of scope,
  «Расхождения»). Реализация в коде аргументом не является. Карта документов — `docs/README.md`.
- Требования, ещё не сделанные в коде (например, три пункта согласия продавца, UC-S2), описаны как
  требования и отражены в «Расхождениях» — не путать с реализованным поведением.
- Бизнес-документы пишутся для людей без технического образования: просто, коротко, без кода и
  путей к файлам. Техника — только в `docs/design/`, `docs/CI-CD.md`, `docs/OBSERVABILITY.md`,
  `docs/procedures/PROD-MIGRATION.md`.
- Старые номера S1…A6 в комментариях кода → таблица в `docs/use-cases/00-overview.md`.

## Стек и сервисы
- `backend/` — FastAPI, SQLAlchemy 2.1 async, asyncpg, Alembic, arq, Python 3.14, Poetry 2, Ruff.
- `frontend/` — React 19, Vite 8, TanStack Query 5, Telegram WebApp, Node 26, Vitest.
- Сервисы compose: `postgres, redis, minio(+createbuckets), backend, bot, notifications-worker,
  receipt-pipeline-worker, frontend (nginx), caddy` + мониторинг `prometheus, loki, promtail, grafana`.
- Старт бэкенда: `alembic upgrade head` → `python -m src.scripts.seed_dev` (core-сид `backend/seed_dev.sql`:
  бренд, админы, города; демо — `backend/seed_demo.sql` только при `SEED_DEMO=true`) → uvicorn.
- Проверка чеков: реально работает только proverkacheka (нужен `PROVERKACHEKA_TOKEN`) и заглушка
  стенда (`CHECK_PROVIDER_STUB=true`); ФНС / Платформа ОФД / Такском — без адаптеров.

## Среды
| | Стенд | Прод |
|---|---|---|
| Адрес | `https://test-nekuro.online` | `https://shamilara.fun` |
| Ветка | `develop` — автодеплой на push | `main` — автодеплой на push (GitHub Environment `test`; включить required reviewer) |
| Где | этот хост, `/srv/vliq-stage`, compose-проект `vliq-stage`, контейнеры `vliq-backend`, `vliq-frontend`, `vliq-postgres`, … | отдельный сервер, `/srv/VLIQ-things/VLIQ-Backend`, проект `vliq-backend` |
| Оверлей | `docker-compose.stage.yml` (`SEED_DEMO=true`, `CHECK_PROVIDER_STUB=true`, мониторинг выключен) | `docker-compose.test.yml` (тома данных `external`) |
| Данные | только синтетика | живые продавцы — **на стенд и сюда не копируются** |

Рабочий чекаут на этом хосте: `/home/nesterkakoi-to/work/VLIQ-Backend`, рабочая ветка
`fix/review-card-compact`, пуш в стенд — `fix/review-card-compact:develop`. **Пушить двумя отдельными
командами** (составная `push && push` отклоняется):
```bash
git -C /home/nesterkakoi-to/work/VLIQ-Backend push -q origin fix/review-card-compact
git -C /home/nesterkakoi-to/work/VLIQ-Backend push -q origin fix/review-card-compact:develop
```
**В `main` и на прод — только с явного «да» владельца.** CI-статус: `gh` здесь не авторизован —
публичный API: `curl -s "https://api.github.com/repos/nester512/VLIQ-Backend/actions/runs?head_sha=<sha>"`,
причина падения — `…/check-runs/<job_id>/annotations`.

## Ограничения этого хоста
- Общий хост на 8 ГБ, рядом чужие проекты и боты (`portainer`, `frontend-services-*` — не трогать).
  **Тяжёлые образы не собирать** (собирает CI); если неизбежно — по одному, `--memory=1500m`, только wheels.
  2026-10-09 параллельная сборка выбила память и уронила все боты на хосте.
- На хосте есть `python3`, `node` 20, `perl`, но версии проекта (3.14 / 26) — **только в Docker**.
- Образы запекают исходники: правка на хосте не влияет на работающий контейнер.
- `sleep` в foreground заблокирован — ожидание через `run_in_background`.
- Пути в `docker run -v` — абсолютные (cwd дрейфует между вызовами).
- Правки с кириллицей — через Edit/Write: `perl -0pi` с UTF-8 в шаблоне молча не срабатывает или портит кодировку.

## Как проверять (команды проверены 2026-10-11…13)
```bash
R=/home/nesterkakoi-to/work/VLIQ-Backend
# 1. Бэкенд: Ruff + юнит (образ vliq-backend-dev314 — с dev-зависимостями, уже собран)
docker run --rm -v $R/backend:/work -w /work vliq-backend-dev314 sh -c \
  'ruff check src tests -q && python -m pytest --ignore=tests/integration --ignore=tests/migrations -q'
# 2. Бэкенд на настоящей PG (контейнер vliq-pgtest-db, сеть vliq-pgtest); перед прогоном — чистая схема
docker exec vliq-pgtest-db psql -U vliq -d vliq_test -qc "DROP SCHEMA IF EXISTS vliq CASCADE; DROP TABLE IF EXISTS public.alembic_version;"
docker run --rm --network vliq-pgtest -e TEST_PG_URL=postgresql+asyncpg://vliq:vliq_dev@vliq-pgtest-db:5432/vliq_test \
  -v $R/backend:/work -w /work vliq-backend-dev314 python -m pytest tests/integration tests/migrations -q
# 3. Фронтенд — всё вместе (зелёный vitest без tsc — не успех)
docker run --rm -m 1500m -v $R/frontend:/app -w /app node:26-alpine sh -c \
  'npx tsc -b && npx eslint src && npx vitest run && npx vite build'
# 4. API-регресс на стенде (~100 проверок, синтетика 7000xxxx; дважды подряд → 429, подождать)
docker exec -i vliq-backend python - < $R/ops/regression/stage_regression.py
# 5. Экраны и «назад» на стенде (Playwright в Docker, обе роли, 344/412 px)
sh $R/ops/regression/ui/run.sh          # LAYOUT issues=0, BACK fails=0
```
- Ожидаемо на 2026-10-11: бэкенд юнит 455, PG+миграции 133, фронтенд 316, API 104 — всё зелёное.
- `frontend/e2e/` (Playwright) в CI **не запускается** — его заменяет шаг 5.
- Если `vliq-backend-dev314` или `vliq-pgtest-db` пропали: образ — `python:3.14-slim` + `poetry install --with dev`
  (`POETRY_INSTALLER_ONLY_BINARY=:all:`, `--memory=1500m`); PG — `postgres:16-alpine`, БД `vliq_test`,
  пользователь `vliq`, в сети `vliq-pgtest`.

## Правило владельца: каждый баг и улучшение (2026-10-11)
Задача **не готова**, пока не сделано всё:
1. Поведение записано в `docs/use-cases/` — в UC интерфейса, где его видно, простым языком;
   расхождение кода с решением — в «Расхождения»; новое решение — в таблицу решений обзора.
2. Тест воспроизводит исходную проблему: **без правки падает, с правкой проходит** (проверь откатом).
   Сценарий из нескольких шагов — интеграционный тест (образец `frontend/src/router/AppRouter.back.test.tsx`);
   деньги и данные — PG-тест (`backend/tests/integration/pg/`).
3. Строка в `docs/testing/REGRESSION.md` и пункт в `docs/testing/REQUEST-HISTORY.md`.
Чек-лист — `.github/pull_request_template.md`. Тест проверяет новое поведение, а не закрепляет старое.
Грабли мок-сессий: эндпоинт с Pydantic-ответом требует полностью заполненный мок (образец
`backend/tests/seller/test_get_seller_by_id.py`). Время в тестах — замороженное (`vi.setSystemTime`).

## Данные прода: ни одна строка не теряется
- **Миграции — только expand → contract.** Релиз добавляет (таблицы, `NULL`/`server_default` колонки,
  индексы `CONCURRENTLY` + `IF NOT EXISTS` в `autocommit_block`, образец `0010`); код работает со старой и
  новой схемой. Удаление/переименование/`NOT NULL`/массовый `DELETE|UPDATE` — отдельным поздним релизом
  и **с «да» владельца**. Пересчёт данных — идемпотентно. `lock_timeout = 10s` (env.py). Каждая
  миграция — с PG-тестом (upgrade/downgrade, отпечаток данных, повтор).
- **Перед выкаткой миграций на прод — ночная репетиция** на копии данных прода с итогом `PASS`:
  `ops/migration/rehearse.sh` (порядок — `docs/procedures/PROD-MIGRATION.md`).
- `ops/deploy.sh`: проверка места → проверенный дамп (`.deploy/backups`, 14 шт.) → миграции → переключение
  → `/health`, при сбое — откат образа (база не откатывается). Ночной бэкап — `ops/backup/nightly.sh`.
- **На проде запрещено:** `docker compose down -v`, `docker volume rm|prune`, `docker system prune --volumes`,
  ручной SQL без бэкапа и «да» владельца. Тома данных прода — `external` в `docker-compose.test.yml`.
- Сброс данных — **только локально**, под своим проектом:
  `COMPOSE_PROJECT_NAME=vliq-local docker compose down -v` (имена `vliq-backend_*` и `vliq-stage_*` — серверные).

## Политика данных (организация)
- Никаких реальных персональных данных, токенов и паролей в чате, коде, документах и тестах.
  Токены не печатать; если вставили — не повторять, предложить ротацию.
- Данные прода (продавцы, чеки, выплаты) не копировать на стенд, в репо, в чат. Отчёты по проду —
  только агрегаты (как `ops/migration/fingerprint.sql`). Тесты — на синтетике (`docs/testing/qr-kit/`,
  стендовые 7000xxxx); реальные чеки — только с согласия людей и с решения #infosec.
- Подпись initData для UI-регресса (`ops/regression/ui/sign_initdata.py`) работает только на стенде.

## Частые операции
- **Админ на стенде** (разово, сразу действует; телефон обязателен и уникален):
  ```bash
  docker exec vliq-postgres psql -U vliq -d vliq -c "INSERT INTO vliq.admin (telegram_id, phone_e164, role, brand_ids, is_active, created_at, updated_at) VALUES (<TG_ID>, '+99<TG_ID>', 'admin', '[]'::jsonb, true, now(), now()) ON CONFLICT (telegram_id) DO UPDATE SET is_active=true, role=EXCLUDED.role;"
  ```
  Строка в `backend/seed_dev.sql` применяется **и на проде** при следующей выкатке — только с «да» владельца.
- Источник proverkacheka на стенде выключен (квота владельца); включение — `UPDATE vliq.check_provider SET enabled=…`.
- Восстановление доступа продавца — `docs/procedures/ACCOUNT-RECOVERY.md` (super_admin, только API).

## Указатели
- Схема БД: `backend/erd.md`. Скиллы/агенты/MCP приходят окружением; кастомные — `.claude/`, `backend/.cursor/`.
- Память этой машины: `~/.claude/projects/-home-nesterkakoi-to-work-VLIQ-Backend/memory/`.
- История: `git log`; история запросов владельца — `docs/testing/REQUEST-HISTORY.md`.
