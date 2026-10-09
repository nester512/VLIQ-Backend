# Мониторинг и логи (Prometheus · Loki · Grafana)

## Что собирается
| Источник | Как | Что |
|---|---|---|
| backend | `GET /metrics` (наружу не проксируется) | HTTP: запросы, коды, длительность по ручкам |
| receipt-pipeline-worker | свой порт `9101` | `ofd_requests_total{provider,status}` — каждый вызов источника проверки (ФНС / proverkacheka / …) и результат; `ofd_request_duration_seconds{provider}` |
| notifications-worker | свой порт `9102` | `notification_outbox_pending`, `notification_outbox_dead` — очередь и недоставленные уведомления |
| все контейнеры | promtail → Loki | логи (stdout/stderr), метка `container` |

Порт метрик воркера: `WORKER_METRICS_PORT` (0 — выключить). Конфиги: `ops/prometheus.yml`,
`ops/promtail.yml`, `ops/grafana/` (источники Prometheus + Loki, дашборд `vliq-overview`).
Prometheus хранит 15 дней (`--storage.tsdb.retention.time`).

## Где включено
- **Прод** — сервисы в `docker-compose.yml`, поднимаются вместе со стеком. Grafana только на
  `127.0.0.1:3000` хоста: открывать через SSH-туннель `ssh -L 3000:127.0.0.1:3000 <prod-host>`.
  **`GRAFANA_PASSWORD` в `.env` прода обязателен** — иначе пароль по умолчанию `admin`.
- **Стенд** — выключено профилем `monitoring` (общий хост на 8 ГБ, на нём чужие проекты). Включить на
  время проверки: `docker compose -f docker-compose.yml -f docker-compose.stage.yml --profile monitoring up -d prometheus loki promtail grafana`,
  выключить — `… stop prometheus loki promtail grafana`.

## Полезные запросы
- источники проверки, доля неуспеха за час:
  `sum by (provider) (rate(ofd_requests_total{status!~"ok|not_found"}[1h])) / sum by (provider) (rate(ofd_requests_total[1h]))`
- недоставленные уведомления: `notification_outbox_dead > 0`
- логи бэкенда с ошибками: `{container=~".*backend.*"} |= "error"`
