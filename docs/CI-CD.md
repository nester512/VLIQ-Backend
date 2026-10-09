# CI/CD: две среды — stage и production

| | **Stage** (тестовый стенд) | **Production** (`shamilara.fun`) |
|---|---|---|
| Назначение | ручное и приёмочное тестирование, аудит по use cases (`docs/use-cases/`) | живые продавцы |
| Ветка | `develop` | `main` |
| Деплой | автоматически на push в `develop` | автоматически на push в `main`; ручное подтверждение включается required reviewer в Environment `test` |
| GitHub Environment | `stage` | `test` (историческое имя, секреты `TEST_*`) |
| Compose | `docker-compose.yml` + `docker-compose.stage.yml` | `docker-compose.yml` + `docker-compose.test.yml` |
| Compose project | `vliq-stage` | `vliq-backend` |
| Telegram-бот | отдельный тестовый бот | прод-бот |
| Данные | только синтетика (`SEED_DEMO=true`) и то, что внесли тестировщики | реальные; **на стенд не копируются** |
| Проверка чеков | `OFD_PROVIDER=fake`, `OCR_MODE=demo` (по умолчанию) | по `.env` сервера |
| Мониторинг | выключен (profile `monitoring` в оверлее) | prometheus / loki / promtail / grafana |

Workflow: `.github/workflows/ci-cd.yml`. Серверный entrypoint обеих сред: `ops/deploy.sh`
(`ops/deploy-test.sh` — symlink для обратной совместимости).

## Контракт CI

- Pull request в `main` или `develop`: Ruff, backend unit/functional tests, реальные PostgreSQL/migration
  tests, frontend ESLint/Vitest/build и Docker build (без публикации).
- Push в `develop` или `main`: те же проверки → публикация immutable GHCR-образов
  `vliq-backend` / `vliq-frontend` с тегом **commit SHA** (+ плавающий `stage-latest` / `test-latest`).
  Образ собирается **один раз на SHA**: если SHA уже опубликован (fast-forward `develop → main`),
  образы не пересобираются, а только перетегиваются.
- `develop` → job `Deploy / stage`; `main` → job `Deploy / production (shamilara.fun)`.
  Обе среды получают **один и тот же** образ данного SHA.
- Deploy сериализован в пределах среды (`deploy-stage` / `deploy-test`). Сначала `alembic upgrade head`,
  затем переключение контейнеров. После запуска проверяется публичный `https://<host>/health`
  (ожидается `{"result":"ok"}`). При ошибке application images откатываются на SHA из
  `.deploy/current-image-tag`. Схема БД автоматически не откатывается — миграции должны быть
  backward-compatible.

Рекомендуемый поток: feature-ветка → PR в `develop` → автодеплой на stage → проверка → PR `develop → main`
→ прод.

## Переменные `ops/deploy.sh`

| Переменная | По умолчанию (= production) | Stage |
|---|---|---|
| `IMAGE_TAG` | — (обязательна) | commit SHA |
| `COMPOSE_PROJECT_NAME` | `vliq-backend` | `vliq-stage` |
| `DEPLOY_COMPOSE_OVERLAY` | `docker-compose.test.yml` | `docker-compose.stage.yml` |
| `DEPLOY_HEALTH_URL` | `https://shamilara.fun/health` | `https://<stage-host>/health` |

## GitHub: секреты и переменные (только имена)

**Environment `stage`** (`Settings → Environments → New environment → stage`, Deployment branches:
только `develop`):

| Тип | Имя | Что |
|---|---|---|
| secret | `STAGE_SSH_HOST` | IP/hostname stage-сервера |
| secret | `STAGE_SSH_PORT` | SSH-порт |
| secret | `STAGE_SSH_USER` | deploy-пользователь (группа `docker`, без sudo) |
| secret | `STAGE_SSH_PRIVATE_KEY` | приватный Ed25519-ключ **только для стенда** |
| secret | `STAGE_SSH_KNOWN_HOSTS` | строка known_hosts stage-сервера |
| secret | `STAGE_DEPLOY_PATH` | путь к checkout на сервере |
| variable | `STAGE_HOSTNAME` | публичный хост стенда, без `https://` |

**Environment `test`** (production, существующий): `TEST_SSH_HOST`, `TEST_SSH_PORT`, `TEST_SSH_USER`,
`TEST_SSH_PRIVATE_KEY`, `TEST_SSH_KNOWN_HOSTS`, `TEST_DEPLOY_PATH`.

- **Ручное подтверждение прод-деплоя:** `Settings → Environments → test → Required reviewers` → добавить
  ревьюера → Save. Код менять не нужно: job будет ждать «Approve». Там же — `Deployment branches: main`.
- **(Опционально) переименование `test` → `production`:** создать Environment `production`, завести в нём
  те же шесть секретов с теми же значениями, затем в workflow заменить `environment.name: test` на
  `production`, смержить, убедиться в успешном деплое и только потом удалить Environment `test`.
  Переносить секреты нужно вручную: GitHub не показывает и не копирует их значения.

`Settings → Actions → General → Workflow permissions`: разрешить workflow публиковать packages
(`packages: write` задан только image-job). Пакеты GHCR сейчас публичные — серверам для pull логин не нужен,
но deploy-job всё равно выполняет `docker login` токеном job'а (через stdin).

Required checks для `main` (и рекомендуется для `develop`): `Backend / Ruff + unit tests`,
`Backend / PostgreSQL + migrations`, `Frontend / lint + tests + build`, `Containers / build`.

## Stage: одноразовая настройка сервера

1. Docker + compose plugin ≥ 2.24 (оверлей использует `!reset` / `!override`), deploy-пользователь в
   группе `docker`, вход только по SSH-ключам.
2. Checkout в `STAGE_DEPLOY_PATH` с `origin` = `https://github.com/nester512/VLIQ-Backend.git`
   (репозиторий публичный — deploy key не нужен). Tracked-файлы не менять: deploy делает
   `git checkout --detach <SHA>`.
3. `.env` из `.env.example` с **новыми** секретами (не копировать с прода), права `600`:
   `STAGE_HOSTNAME`, `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `JWT_SECRET_SALT`,
   `PAYOUT_ENCRYPTION_KEY`, `TG_BOT_TOKEN` (тестовый бот), `CADDY_TLS_DIRECTIVE` / `CADDY_EMAIL`
   (ACME-email), `OFD_PROVIDER=fake`, `OCR_MODE=demo`.
4. Если порты 80/443 на хосте заняты другим reverse proxy: `STAGE_CADDY_SITE=http://<host>`,
   `STAGE_HTTP_BIND=<адрес>:<порт>` (Caddy только по HTTP), TLS терминирует внешний proxy.
5. Проверка: `COMPOSE_PROJECT_NAME=vliq-stage IMAGE_TAG=<sha> docker compose -f docker-compose.yml -f docker-compose.stage.yml config --quiet`.

Что даёт оверлей стенда: Postgres/Redis/MinIO не публикуются на хост, у них собственные креды;
бакет чеков приватный (картинки отдаются только через подписанный
`/api/v1/receipts/attachments/file?sig=…`); `ENV=prod` (DEV `POST /auth/login` и Swagger выключены);
бот в режиме polling со своим токеном; ротация логов `json-file` 10 MB × 3.

### Ручной deploy / rollback стенда

```bash
cd <STAGE_DEPLOY_PATH>
git fetch origin develop && git checkout --detach <sha>
COMPOSE_PROJECT_NAME=vliq-stage DEPLOY_COMPOSE_OVERLAY=docker-compose.stage.yml \
  DEPLOY_HEALTH_URL=https://<stage-host>/health IMAGE_TAG=<sha> ./ops/deploy.sh
```

Rollback — тот же вызов с предыдущим SHA (`cat .deploy/current-image-tag` до деплоя).

### Админ на стенде

Core-сид (`backend/seed_dev.sql`) на каждом старте создаёт служебных админов. Дополнительного —
разовым SQL **на БД стенда** (Telegram ID в репозиторий не коммитить):

```bash
cd <STAGE_DEPLOY_PATH>
COMPOSE_PROJECT_NAME=vliq-stage IMAGE_TAG=$(cat .deploy/current-image-tag) \
docker compose -f docker-compose.yml -f docker-compose.stage.yml exec -T postgres psql -U vliq -d vliq -c \
 "INSERT INTO vliq.admin (telegram_id, phone_e164, role, brand_ids, is_active, created_at, updated_at) \
  VALUES (<TG_ID>, '+70000000000', 'admin', '[]'::jsonb, true, now(), now()) \
  ON CONFLICT (telegram_id) DO UPDATE SET is_active=true, role=EXCLUDED.role;"
```

### Полный сброс данных стенда

```bash
COMPOSE_PROJECT_NAME=vliq-stage IMAGE_TAG=$(cat .deploy/current-image-tag) \
  docker compose -f docker-compose.yml -f docker-compose.stage.yml down
docker volume rm vliq-stage_postgres_data vliq-stage_minio_data
# затем ручной deploy текущего SHA (см. выше) — backend заново применит миграции и сиды
```

## Production: сервер

1. Deploy-user с доступом к Docker. Checkout в `/srv/VLIQ-things/VLIQ-Backend`, `origin` →
   `nester512/VLIQ-Backend`, без изменений tracked-файлов.
2. Серверный `.env` (не коммитится), минимум:

```dotenv
CADDY_HOSTNAME=shamilara.fun
CADDY_TLS_DIRECTIVE=<acme-email>
CADDY_EMAIL=<acme-email>
TG_BOT_TOKEN=<prod-bot-token>
JWT_SECRET_SALT=<secret>
ENV=prod
OFD_PROVIDER=fake
OCR_MODE=full
```

`ENV=prod` обязателен: без него на публичном домене открыт DEV-логин `POST /auth/login`.
Для реальной проверки ФНС: `OFD_PROVIDER=proverkacheka` и `PROVERKACHEKA_TOKEN`.

3. Проверка: `IMAGE_TAG=<sha> docker compose -f docker-compose.yml -f docker-compose.test.yml config --quiet`.

Прод-оверлей всегда запускает backend с `SEED_DEMO=false`. Разовая чистка ранее насеянного демо:
`docker compose -f docker-compose.yml -f docker-compose.test.yml exec -T postgres psql -U vliq -d vliq < ops/cleanup_demo_seed.sql`
(затрагивает только известные demo Telegram ID, служебных админов `99998`/`99999` и demo-акции).

### Ручной deploy и rollback прода

```bash
cd /srv/VLIQ-things/VLIQ-Backend
git fetch origin main
git checkout --detach <commit-sha>
IMAGE_TAG=<commit-sha> ./ops/deploy.sh
```

Rollback — тот же скрипт с предыдущим SHA. Alembic downgrade автоматически не выполняется; перед breaking
migration сначала выпускается совместимая промежуточная версия.


## Бэкап перед миграцией и восстановление из бэкапа

`ops/deploy.sh` на каждом деплое (стенд и прод) **до** `alembic upgrade head` снимает дамп БД:
`<checkout>/.deploy/backups/<UTC-время>-<sha>.dump` (custom-формат, права 600, хранятся последние
`DEPLOY_BACKUP_KEEP=14`). Дамп проверяется `pg_restore --list`; если дамп не снят или не читается —
деплой останавливается, миграции не запускаются, контейнеры не переключаются.

### Восстановление из бэкапа
Только с явного решения владельца. Сначала — новый дамп текущего состояния (чтобы восстановление
само было обратимым):
```bash
cd <checkout>   # прод: /srv/VLIQ-things/VLIQ-Backend, стенд: STAGE_DEPLOY_PATH
C="docker compose -f docker-compose.yml -f <overlay>"   # прод: docker-compose.test.yml
$C exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > .deploy/backups/before-restore.dump
$C stop backend bot notifications-worker receipt-pipeline-worker
$C exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --single-transaction' \
  < .deploy/backups/<нужный>.dump
# образ — тот, что соответствует схеме дампа (sha в имени файла):
IMAGE_TAG=<sha из имени дампа> ./ops/deploy.sh
```
`--single-transaction`: восстановление либо проходит целиком, либо не меняет ничего.
