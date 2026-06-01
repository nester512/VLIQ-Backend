# VLIQ — Telegram Mini App мотивационной программы для продавцов

VLIQ is a loyalty & bonus platform for vape-shop sales staff. Sellers upload purchase receipts via a Telegram Mini App, earn bonuses, and request payouts. Admins review receipts and approve payouts through the same interface.

## Quick start

```bash
# 1. Copy and configure environment
cp backend/.env.example .env
# Edit .env — set JWT_SECRET_SALT (required). Other defaults work for local dev.

# 2. Start everything with one command
docker compose up

# 3. Open the frontend
open http://localhost
```

`docker compose up` will:
- Start Postgres 16, Redis 7, MinIO, backend (FastAPI), frontend (nginx), and bot (aiogram).
- Auto-run `alembic upgrade head` then `python -m src.scripts.seed_dev` (idempotent).
- The frontend at `http://localhost` proxies `/api/` to the backend at port 8000.
- Swagger UI is available at `http://localhost:8000/swagger`.

## Demo roles

### Seller (telegram_id 12345)

Seed data includes an **active** seller "Алексей Морозов" with the following pre-seeded state:
- Balance: 450 available, 100 on hold
- Receipts: 2 approved, 1 on_review, 1 needs_revision, 1 rejected, 1 paid_out
- Payout requests: 1 new (status `new`)

To get a JWT for this seller (DEV only):
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"id": 12345}'
```

### Admin (telegram_id 809296638)

Seed data includes a `super_admin` "Admin VLIQ".

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"id": 809296638}'
```

Admin can:
- `GET /api/v1/receipts?status=on_review` — review pending receipts
- `POST /api/v1/receipts/{id}/approve` — approve (creates bonus_transaction)
- `POST /api/v1/receipts/{id}/reject` — reject with reason
- `POST /api/v1/receipts/{id}/revise` — request revision (status → needs_revision)
- `POST /api/v1/payout-requests/{id}/approve` — approve payout

### Other seed sellers

| telegram_id | Status  | Note                                |
|-------------|---------|-------------------------------------|
| 10000001    | active  | has a paid payout + in_progress     |
| 10000002    | active  | has on_review receipt               |
| 10000003    | active  | has needs_revision receipt          |
| 10000004    | pending | incomplete registration             |
| 10000005    | blocked | cannot log in                       |

## HTTPS / TLS

VLIQ uses [Caddy](https://caddyserver.com) as the TLS-terminating reverse proxy in front of both the frontend and backend. Caddy is configured via `Caddyfile` at the repo root and is driven by three environment variables (all have sane defaults for local dev):

| Variable | Dev default | Prod example |
|---|---|---|
| `CADDY_HOSTNAME` | `vliq.local` | `app.yourdomain.com` |
| `CADDY_TLS_DIRECTIVE` | `internal` (Caddy local CA) | *(leave empty — Caddy uses Let's Encrypt automatically)* |
| `CADDY_EMAIL` | `admin@example.com` | `ops@yourdomain.com` |

### Dev setup (self-signed local CA)

1. Add a hosts entry so `vliq.local` resolves to localhost:
   ```bash
   echo "127.0.0.1 vliq.local" | sudo tee -a /etc/hosts
   ```
2. Start the stack:
   ```bash
   docker compose up
   ```
3. Open `https://vliq.local` — your browser will warn once about the self-signed certificate.

**Optional: trust Caddy's local CA** (removes the browser warning permanently):
```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
# macOS:
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./caddy-root.crt
# Linux (Debian/Ubuntu):
sudo cp ./caddy-root.crt /usr/local/share/ca-certificates/caddy-root.crt && sudo update-ca-certificates
```

### Prod setup (automatic Let's Encrypt)

1. Point your DNS A/AAAA record at the server.
2. Set the following in `.env` (or as real environment variables):
   ```env
   CADDY_HOSTNAME=app.yourdomain.com
   CADDY_TLS_DIRECTIVE=
   CADDY_EMAIL=ops@yourdomain.com
   ```
   When `CADDY_TLS_DIRECTIVE` is empty, Caddy uses the global `email` directive and provisions a certificate via Let's Encrypt automatically on the first request.
3. `docker compose up` — no further TLS ceremony required.

## Telegram bot

Set `TG_BOT_TOKEN` in `.env` to a token from [@BotFather](https://t.me/BotFather).

The `bot` service starts automatically when `docker compose up` is run (depends on `backend` being healthy).

```bash
# Test the bot locally (without Docker):
cd backend
TG_BOT_TOKEN=your_token TMA_URL=https://your-app-url poetry run python -m src.bot
```

Bot commands:
- `/start` — sends welcome message with an "Открыть VLIQ" inline button (WebAppInfo pointing to `TMA_URL`).
- `/help` — describes the app.

Set `TMA_URL` env var to your Mini App URL (e.g. `https://t.me/<botname>/<appname>` or an ngrok HTTPS URL for local dev). The default is `https://t.me/vliq_bot/app`.

### Bot modes

The bot supports two runtime modes, toggled by `BOT_MODE` in `.env`.

| Mode | When to use | Requirements |
|------|-------------|--------------|
| `polling` (default) | Local dev, CI, any environment without public HTTPS | Just `TG_BOT_TOKEN` — no open ports, no TLS |
| `webhook` | Pre-prod / production with multiple instances or faster delivery | HTTPS (Caddy), the Caddyfile route below, `BOT_WEBHOOK_HOST`, `BOT_WEBHOOK_SECRET` |

**Dev (long polling):**
```env
BOT_MODE=polling
```
No additional setup needed. Telegram delivers updates via long-lived HTTP requests initiated by the bot.

**Pre-prod / Production (webhook):**
```env
BOT_MODE=webhook
BOT_WEBHOOK_HOST=your-public-hostname.example.com   # must match CADDY_HOSTNAME
BOT_WEBHOOK_SECRET=<random 32+ char string>          # python -c "import secrets; print(secrets.token_urlsafe(32))"
BOT_WEBHOOK_PORT=8081                                # internal container port (default)
```
On startup the bot registers `https://<BOT_WEBHOOK_HOST>/tg-webhook/<BOT_WEBHOOK_SECRET>` with Telegram and removes it on graceful shutdown (SIGTERM), so rolling re-deploys do not lose in-flight messages.

**Flip modes:**
```bash
# Edit .env, then:
docker compose restart bot
```

#### Required Caddyfile route (webhook mode only)

The Caddy agent owns the `Caddyfile`. When enabling webhook mode, add this block **inside the site block** in `Caddyfile` before restarting Caddy:

```
# Telegram webhook — routes incoming updates to the bot container.
handle /tg-webhook/* {
  reverse_proxy bot:8081
}
```

This must be merged into `Caddyfile` before switching `BOT_MODE=webhook` in production.

## Storage backends

| `RECEIPT_STORAGE` | Description |
|---|---|
| `local` | Files saved to `var/receipts/` on the container filesystem |
| `s3` (default in Docker) | Files uploaded to S3-compatible storage (MinIO, AWS S3, Yandex OS) |

Docker Compose sets `RECEIPT_STORAGE=s3` pointing at the local MinIO instance.

To switch to local filesystem storage in `.env`:
```env
RECEIPT_STORAGE=local
```

### MinIO (local S3)

- S3 API: `http://localhost:9000`
- Web console: `http://localhost:9001` (login: `minioadmin` / `minioadmin`)
- Bucket `vliq-receipts` is auto-created on startup by the `createbuckets` service.

### AWS S3 / Yandex Object Storage

```env
RECEIPT_STORAGE=s3
S3_BUCKET=your-bucket
S3_ENDPOINT_URL=                                # empty for AWS; https://storage.yandexcloud.net for Yandex
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_REGION=us-east-1
```

## Observability

After `docker compose up`, the observability stack starts automatically alongside the application.

### Access

| Service | URL | Credentials |
|---|---|---|
| Grafana | `http://localhost:3000` | `admin` / `admin` (or `GRAFANA_USER` / `GRAFANA_PASSWORD`) |
| Prometheus | internal only (`http://prometheus:9090`) | n/a — use Grafana |

Grafana opens with two pre-provisioned datasources (Prometheus + Loki) and a **VLIQ Overview** dashboard under **Dashboards**.

### Dashboard panels

- **Request Rate** — `rate(http_requests_total[5m])` by route
- **Error Rate (5xx)** — HTTP 5xx breakdown by route
- **P95 Latency** — `histogram_quantile(0.95, ...)` per route
- **OFD Success Rate** — `ofd_requests_total{status="ok"}` / total, per provider
- **Notification Outbox Depth** — pending and dead-letter counts (stat panel)
- **Backend Logs** — last 100 lines from the backend container via Loki

### Logs

All container stdout flows to Loki automatically via Promtail watching the Docker socket. No application changes are required for log collection.

### Custom metrics exposed by backend

| Metric | Type | Labels | Where observed |
|---|---|---|---|
| `ofd_requests_total` | Counter | `provider, status` | `proverkacheka.py` per-attempt outcome |
| `ofd_request_duration_seconds` | Histogram | `provider` | `proverkacheka.py` per-attempt duration |
| `receipt_pipeline_duration_seconds` | Histogram | `status` | `orchestrator.py` pipeline completion |
| `notification_outbox_pending` | Gauge | — | `outbox.refresh_outbox_gauges()` each drain cycle |
| `notification_outbox_dead` | Gauge | — | `outbox.refresh_outbox_gauges()` each drain cycle |

HTTP instrumentation (request rate, error rate, latency) is provided automatically by `prometheus-fastapi-instrumentator` at `/metrics`.

## Running tests

```bash
cd backend
poetry install
poetry run pytest tests/ -q                              # all tests
poetry run pytest tests/ -m integration -q              # integration smoke only
poetry run pytest tests/ -m "not integration" -q        # unit tests only
```

## Architecture docs

- [`backend/docs/ofd-providers.md`](backend/docs/ofd-providers.md) — OFD provider configuration and fake/stub mode.
- [`backend/docs/receipt-status-machine.md`](backend/docs/receipt-status-machine.md) — Receipt lifecycle state machine.
- [`backend/erd.md`](backend/erd.md) — Entity-relationship diagram.

## Project structure

```
VLIQ-BOT/
├── backend/             FastAPI + SQLAlchemy 2.0 async + Alembic (Python 3.12, Poetry)
│   ├── src/
│   │   ├── app/         FastAPI app factory, lifespan, middleware, settings
│   │   ├── auth/        TMA initData verification + DEV login
│   │   ├── seller/      Seller CRUD + /me endpoints
│   │   ├── receipt/     Receipt upload, status machine, admin actions
│   │   ├── payout_request/  Payout flow (atomic create + approve)
│   │   ├── bot/         aiogram 3 bot (long-polling, /start, /help)
│   │   └── scripts/     seed_dev.py — idempotent seed runner
│   ├── tests/
│   │   └── integration/ test_business_process.py — full flow smoke test
│   ├── Dockerfile       Multi-stage (builder + runtime); bot uses same image
│   └── seed_dev.sql     Demo data covering all statuses
├── frontend/            Vite + React 19 + TypeScript + Tailwind 4 + TMA SDK
│   ├── Dockerfile       Multi-stage (node build + nginx serve)
│   └── nginx.conf       SPA fallback + /api/ proxy to backend
└── docker-compose.yml   Full stack: postgres + redis + minio + backend + bot + frontend
```
