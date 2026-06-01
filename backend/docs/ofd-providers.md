# OFD Providers

## Activation checklist — proverkacheka.com (recommended for MVP)

1. Register at https://proverkacheka.com — free tier, no payment required.
   After registration, copy your API token from the account dashboard.
2. In `backend/.env`, set:
   ```
   OFD_PROVIDER=proverkacheka
   PROVERKACHEKA_TOKEN=<your_token_here>
   ```
3. Restart the backend: `docker compose restart backend` (or `poetry run uvicorn …`).
4. Smoke test: upload a real receipt photo via the Telegram bot.
   The pipeline should reach status `on_review` (not `needs_revision`).
5. Monitor logs: look for structured log entries with `provider=proverkacheka`
   and `http_status=200`.  Any `proverkacheka.rate_limit` or
   `proverkacheka.transient_error` entries indicate upstream problems.

### Rate limits & quotas (free tier)

| Tier | Requests/month | Price |
|------|----------------|-------|
| Free | ~100           | 0 RUB |
| Paid | Negotiable     | Contact sales |

HTTP 429 responses are handled automatically: the client reads the `Retry-After`
header (or falls back to exponential backoff) and retries up to
`OFD_RETRY_MAX_ATTEMPTS` times (default: 3).

### Fallback on upstream errors

If proverkacheka.com is unreachable or returns unrecoverable errors after all
retries, the pipeline orchestrator (`receipt_pipeline/orchestrator.py`) catches
`OFDError` and transitions the receipt to `needs_revision`.  The user sees a
"manual review" message.  No data is lost — the receipt image remains in storage.

---

## Provider details

### 1. proverkacheka.com (MVP — implemented)

**Status**: `ProverkachekaClient` is **fully implemented** in
`src/ofd_client/proverkacheka.py`.

**Features**:
- Real HTTP calls to `https://proverkacheka.com/api/v1/check/get`
- Timeout configurable via `OFD_TIMEOUT_SECONDS` (default: 10 s)
- Retry configurable via `OFD_RETRY_MAX_ATTEMPTS` (default: 3)
- HTTP 429: reads `Retry-After` header, falls back to exponential backoff
- HTTP 5xx / timeout / connect error: exponential backoff (1 s, 2 s, 4 s, …)
- HTTP 401 / 403: immediate `OFDBlockedError` (bad token — do not retry)
- HTTP 404 / app code 2: immediate `OFDNotFoundError`
- Structured logging on every attempt (`provider`, `attempt`, `http_status`, `duration_ms`)
- Amounts are in **kopecks** (`totalSum`, `price`, `sum` fields)

**Docs**: https://proverkacheka.com/api

---

### 2. FNS / nalog.ru public API

**Auth model**: requires a Gosuslugi account token + ФНС certificate trust
(ГОСТ TLS). The API is documented at:
https://www.nalog.gov.ru/rn77/related_activities/registries/kkt/

**Implementation complexity**: very high — OAuth2/ESIA auth, ГОСТ-TLS client
certificate, undocumented JSON schema (reverse-engineered from Android app).
Community Python libs (`fns-check`, `checkonline`) exist but are abandoned
(last commits 2021-2022) and do not cover all edge cases.

**Rate limit / cost**: free but limited (~10 req/min without a registered app).

**Verdict**: not recommended for MVP. Use only if proverkacheka.com is
unavailable and you have the ops capacity to maintain ГОСТ-TLS in a container.

---

### 3. kkt-online / community libs

Several PyPI packages wrap the FNS API:

| Package | PyPI | Last release | Notes |
|---------|------|-------------|-------|
| `fns-check` | yes | 2022 | Archived, no async |
| `checkonline` | yes | 2021 | Sync only, unmaintained |
| `kktonline` | no (GitHub) | 2020 | Proof-of-concept |

All rely on undocumented FNS endpoints that may break without notice.

**Verdict**: avoid.

---

### 4. Commercial OFD operators (Yandex.OFD, Platforma OFD, OFD.ru)

All require a signed B2B contract and per-request pricing. They offer reliable
SLA and structured JSON responses. Suitable for production when volume exceeds
proverkacheka.com free tier.

A stub adapter `src/ofd_client/ofd_ru.py` (`OfdRuClient`) is already wired into
the factory as `OFD_PROVIDER=ofd_ru`.  Fill in the implementation following the
TODO comments in that file; no factory changes are needed.

**Docs**:
- Platforma OFD: https://platformaofd.ru/developers/
- OFD.ru: https://ofd.ru/api

**Verdict**: P2 — revisit when monthly request volume exceeds ~500.

---

## P2 follow-ups

- **Circuit breaker**: wrap `ProverkachekaClient` with a circuit breaker
  (e.g. `circuitbreaker` library) so cascading failures degrade gracefully.
- **Prometheus metric**: export `ofd_requests_total{provider, status}` counter
  and `ofd_request_duration_seconds` histogram via a `/metrics` endpoint.
- **Multi-provider fallback chain**: if the primary provider fails, automatically
  retry with a secondary (e.g. proverkacheka → FNS direct).  Implement as a
  `FallbackOFDClient(primary, secondary)` adapter.
- **Paid proverkacheka tier**: when free tier (~100 req/month) is exhausted,
  purchase a paid plan — no code changes needed, same API and client.
