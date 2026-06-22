# CI/CD и тестовый стенд `shamilara.fun`

## Контракт

- Pull request в `main`: Ruff, backend unit/functional tests, реальные PostgreSQL/migration tests,
  frontend ESLint/Vitest/build и production Docker build.
- Push/merge в `main`: те же проверки → публикация immutable GHCR-образов с тегом commit SHA →
  автоматический deploy на `https://shamilara.fun`.
- Deploy сериализован. Новая версия переключается только после успешной миграции. После запуска
  проверяется публичный backend `/health`; при ошибке application images возвращаются на предыдущий
  записанный SHA. Схема БД автоматически не откатывается, поэтому миграции должны быть backward-compatible.

Workflow: `.github/workflows/ci-cd.yml`. Серверный entrypoint: `ops/deploy-test.sh`.

## Одноразовая настройка GitHub

Создать Environment **`test`** в `Settings → Environments` без required reviewers, если deploy должен
быть полностью автоматическим. В Environment добавить secrets:

| Secret | Значение |
|---|---|
| `TEST_SSH_HOST` | IP или SSH hostname тестового сервера |
| `TEST_SSH_PORT` | обычно `22` |
| `TEST_SSH_USER` | непривилегированный deploy-user с доступом к Docker |
| `TEST_SSH_PRIVATE_KEY` | приватный Ed25519-ключ GitHub Actions → server |
| `TEST_SSH_KNOWN_HOSTS` | проверенная строка known_hosts для сервера |
| `TEST_DEPLOY_PATH` | `/srv/VLIQ-things/VLIQ-Backend` |

В `Settings → Actions → General → Workflow permissions` разрешить workflow создавать packages
(`packages: write` задан только image-job). После первого запуска при необходимости сделать пакеты
`vliq-backend` и `vliq-frontend` доступными этому репозиторию в настройках GHCR.

Для `main` включить branch protection и required checks:

- `Backend / Ruff + unit tests`;
- `Backend / PostgreSQL + migrations`;
- `Frontend / lint + tests + build`;
- `Containers / build`.

## Одноразовая настройка сервера

1. Deploy-user должен иметь доступ к Docker и read-only доступ к приватному GitHub-репозиторию.
2. Репозиторий должен существовать в `/srv/VLIQ-things/VLIQ-Backend`, remote `origin` должен указывать
   на `nester512/VLIQ-Backend`. Рабочее дерево не должно содержать изменения tracked-файлов: deploy
   использует detached checkout точного проверенного SHA.
3. В корне оставить серверный `.env` минимум с:

```dotenv
CADDY_HOSTNAME=shamilara.fun
CADDY_TLS_DIRECTIVE=admin@example.com
CADDY_EMAIL=admin@example.com
TG_BOT_TOKEN=...
JWT_SECRET_SALT=...
OFD_PROVIDER=fake
OCR_MODE=full
```

Для реальной проверки ФНС заменить `OFD_PROVIDER=proverkacheka` и задать
`PROVERKACHEKA_TOKEN`. `.env` не коммитится и сохраняется между checkout.

4. Проверить сервер локально:

```bash
cd /srv/VLIQ-things/VLIQ-Backend
IMAGE_TAG=<существующий-ghcr-sha> docker compose \
  -f docker-compose.yml -f docker-compose.test.yml config --quiet
```

`postgres`, `redis`, MinIO и Grafana привязаны к `127.0.0.1`; наружу публикуются только Caddy
`80/443`. MinIO receipt bucket доступен через HTTPS `https://shamilara.fun/storage/...`.

## Ручной deploy и rollback

Deploy конкретной уже опубликованной ревизии:

```bash
cd /srv/VLIQ-things/VLIQ-Backend
git fetch origin main
git checkout --detach <commit-sha>
IMAGE_TAG=<commit-sha> ./ops/deploy-test.sh
```

Для ручного rollback запустить тот же скрипт с предыдущим SHA. Alembic downgrade автоматически не
выполняется. До деплоя breaking migration сначала выпускается совместимая промежуточная версия.
