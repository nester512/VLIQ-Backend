# VLIQ-Backend — контекст и операционка для агентов

Хэндофф между сессиями: **что это, чем ограничено, как запускается/тестируется/деплоится**.
Конвенции кода и раскладку модулей не дублирую — см. `backend/AGENTS.md` и `frontend/AGENTS.md`.

## Что это
Монорепо Telegram Mini App «VLIQ» (мотивационная программа продавцов: загрузка
чеков → проверка ФНС/OFD → бонусы → выплаты; роли seller/admin/super_admin).
- `backend/` — FastAPI + SQLAlchemy 2.0 async + asyncpg + Alembic, Python 3.12, Poetry.
- `frontend/` — React 19 + Vite + TanStack Query + Telegram SDK (TMA).
- `docs/` — use-cases / userstories / контракт-аудит (`USERCASES_2026-05.md` — чек-лист «что реально работает»).
- `docker-compose.yml` (+ `docker-compose.override.yml` для прод-домена) — весь стек.
- **Живой деплой:** `https://shamilara.fun` (этот сервер).

## Как всё запускается (launch conditions)
Стек поднимается из корня репо: `docker compose up -d`.
Порядок: `postgres`/`redis`/`minio` healthy → `createbuckets` (бакет `vliq-receipts`)
→ **backend boot:** `alembic upgrade head && python -m src.scripts.seed_dev && uvicorn`.
- `src/scripts/seed_dev.py` **прогоняет `backend/seed_dev.sql` на каждом старте** (идемпотентно):
  сидит бренд, админов (`809296638, 99999, 99998` + owner `997459169`) и демо-данные.
  → Чтобы добавить админа: строка в `seed_dev.sql` (переживёт ребилд) или разовый SQL (ниже).
- Сервисы: `backend, bot, notifications-worker, receipt-pipeline-worker, frontend, caddy,
  postgres, redis, minio, prometheus, loki, promtail, grafana`.
- Конфиг: `.env` + `docker-compose.override.yml` (домен, ACME-email Caddy, `TMA_URL`).
- Флаги-заглушки сейчас: `OCR_MODE=demo`, `OFD_PROVIDER=fake` (реальные клиенты есть в коде).
- `TG_BOT_TOKEN` нужен для уведомлений (notifications-worker дренит outbox раз в 5с).

### Авторизация
- Прод: только внутри Telegram — `POST /auth/tma-verify` валидирует `initData` (HMAC по `TG_BOT_TOKEN`).
- Роль определяется бэкендом: сначала ищется в `vliq.admin` → иначе seller (авто-создание `pending`).
- Фронт **ре-верифицирует роль при каждом открытии** Mini App (`useAuthFlow.ts`) — смена роли подхватывается без чистки кэша.
- DEV вне Telegram: `POST /auth/login {id}` + mock-login `telegram_id=12345` (отключено в prod).

## Ограничения этого окружения (ВАЖНО для проверки/деплоя)
- **На хосте нет python/pip/poetry/node/npm.** Всё гонять через Docker.
- **Образы запекают исходники (нет volume-mount).** Правка файла на хосте НЕ влияет на
  работающий контейнер — нужен ребилд + пересоздание (`docker compose up -d --build <svc>`).
- **Runtime-образ бэкенда ставит `--only main`** — внутри **нет pytest** (dev-deps).
- **Сеть доступна** (docker pull, npm ci, pip install работают).
- **`sleep` в Bash заблокирован** в foreground — фоновые задачи через `run_in_background`.
- `cd` в составной bash-команде может триггерить prompt — используй `git -C <path>` / абсолютные пути.

## Как проверять правки (verified-команды)
```bash
# Backend-тесты (мок-сессии, реальная БД НЕ нужна; ставим dev-deps на лету, исходники монтируем в /work):
docker run --rm -v "$PWD/backend":/work -w /work vliq-backend-backend sh -c \
  'pip install -q "pytest>=8,<9" "pytest-asyncio>=0.23,<0.24" "respx>=0.21,<0.22" && \
   python -m pytest tests/receipt_pipeline tests/receipt tests/notification tests/seller -q'

# Быстрая логика без pytest (venv на /app/.venv; нужны env для Settings()):
docker run --rm -v "$PWD/backend":/work -w /work \
  -e JWT_SECRET_SALT=x -e POSTGRES__POSTGRES_URL=postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq_test \
  -e TG_BOT_TOKEN=1:t vliq-backend-backend python -c 'import src...; ...'

# Frontend typecheck + lint (node_modules .dockerignore'нут, на хост попадёт после npm ci — это ок, gitignore):
docker run --rm -v "$PWD/frontend":/app -w /app node:22-alpine sh -c 'npm ci && npx tsc -b && npx eslint <file>'
```
Тесты используют мок-сессии (`backend/tests/conftest.py` оверрайдит `get_pg_session`; lifespan не запускается под ASGITransport). Полный прогон с интеграциями требует отдельную БД `vliq_test`.

## Как деплоить
```bash
# Точечно: пересобрать и пересоздать сервис(ы)
docker compose up -d --build backend frontend notifications-worker

# Доступ к БД / провижн админа (без ребилда — на живой БД):
docker compose exec -T postgres psql -U vliq -d vliq -c \
 "INSERT INTO vliq.admin (telegram_id, phone_e164, role, brand_ids, is_active, created_at, updated_at) \
  VALUES (<TG_ID>, '+7990XXXXXXX', 'super_admin', '[]'::jsonb, true, now(), now()) \
  ON CONFLICT (telegram_id) DO UPDATE SET is_active=true, role='super_admin';"
```
### Чистый ребилд без кеша + свежие данные (для чистого тестирования)
```bash
docker compose build --no-cache                 # все build-сервисы с нуля
docker compose down --remove-orphans
docker volume rm vliq-backend_postgres_data vliq-backend_minio_data   # СВЕЖИЕ данные
docker compose up -d                            # backend пере-сидит БД на старте
```
- **НЕ удалять `vliq-backend_caddy_data`** — там TLS-сертификат shamilara.fun; пересоздание
  рискует лимитом Let's Encrypt → HTTPS ляжет. Волюмы мониторинга тоже можно сохранять.
- **Не трогать чужие проекты на хосте:** `portainer`, `frontend-services-*`.

## Скиллы / агенты / MCP
Это **окружение**, а не контекст чата — Claude Code инжектит список доступных скиллов, агентов
(`Explore`, `Plan`, `general-purpose`, `claude-code-guide`, …) и MCP-серверов (Figma, Atlassian,
session-mgmt, …) в **каждую** новую сессию. Передавать их вручную не нужно.
**Кастомные** живут в файлах репо: `.claude/`, а также `backend/.cursor/{agents,commands,rules}` —
они едут вместе с репозиторием.

## Указатели
- Код-конвенции/модули: `backend/AGENTS.md`, `frontend/AGENTS.md` (часть статусов там устарела — сверяйся с кодом).
- Чек-лист фич: `docs/USERCASES_2026-05.md`. Схема БД: `backend/erd.md`.
- Приватная auto-memory (только эта машина): `~/.claude/projects/-srv-VLIQ-things-VLIQ-Backend/memory/`.
- История правок: `git log` (последняя волна — коммит `7fd0599`, ветка `dev-validate-seller-use-cases`).
