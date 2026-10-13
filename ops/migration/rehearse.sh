#!/usr/bin/env bash
# Night rehearsal of the database migration on a COPY of the production data.
#
# Runs on the production host, from the checkout (repo root). It never writes to the live database:
# the live server is only read by pg_dump; the copy lives in a throwaway container on its own internal
# network and is deleted at the end. Output — aggregates only (counts, sums, checksums), no personal data.
#
#   IMAGE_TAG=<sha of the release> ops/migration/rehearse.sh            # fresh dump of the live DB
#   IMAGE_TAG=<sha> DUMP=.deploy/backups/<file>.dump ops/migration/rehearse.sh
#
# Stage only (its data is already migrated): REHEARSE_FROM=0008_seller_outlet_count first takes the
# copy back to the production schema, so the whole path 0008 → head can be tried there.
set -Eeuo pipefail

: "${IMAGE_TAG:?IMAGE_TAG = commit SHA of the release whose migrations are rehearsed}"
readonly BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/nester512/vliq-backend}:${IMAGE_TAG}"
readonly OVERLAY="${DEPLOY_COMPOSE_OVERLAY:-docker-compose.test.yml}"
readonly -a LIVE=(docker compose -f docker-compose.yml -f "${OVERLAY}")
readonly NET=vliq-rehearsal DB=vliq-rehearsal-db VOL=vliq-rehearsal-data PG_IMAGE=postgres:16-alpine
OUT=".deploy/rehearsal/$(date -u +%Y%m%dT%H%M%SZ)-${IMAGE_TAG:0:12}"
HERE="$(cd "$(dirname "$0")" && pwd)"
readonly OUT HERE
readonly URL="postgresql+asyncpg://vliq:rehearsal@${DB}:5432/vliq"
mkdir -p "${OUT}"
chmod 700 "${OUT}"

cleanup() {
  docker rm -f "${DB}" >/dev/null 2>&1 || true
  docker volume rm "${VOL}" >/dev/null 2>&1 || true
  docker network rm "${NET}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup  # a previous run that was interrupted

say() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "${OUT}/log.txt"; }
psql_copy() { docker exec -i "${DB}" psql -U vliq -d vliq -v ON_ERROR_STOP=1 "$@"; }
alembic() { docker run --rm --network "${NET}" -e POSTGRES__POSTGRES_URL="${URL}" -e JWT_SECRET_SALT=rehearsal \
  -e TG_BOT_TOKEN=1:rehearsal "${BACKEND_IMAGE}" alembic "$@"; }
fingerprint() { psql_copy -At -F '|' < "${HERE}/fingerprint.sql" > "${OUT}/$1.txt"; }

# 1. The data: a fresh read-only dump of the live database, or the given one
dump="${DUMP:-}"
if [[ -z "${dump}" ]]; then
  dump="${OUT}/live.dump"
  say "dump of the live database (read-only)…"
  # shellcheck disable=SC2016  # expands inside the container
  "${LIVE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${dump}"
  chmod 600 "${dump}"
fi
say "dump: ${dump} ($(du -h "${dump}" | cut -f1))"

# 2. The copy: its own internal network (no internet, nothing else on it), its own volume
docker network create --internal "${NET}" >/dev/null
docker run -d --name "${DB}" --network "${NET}" -v "${VOL}:/var/lib/postgresql/data" \
  -e POSTGRES_USER=vliq -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=vliq "${PG_IMAGE}" >/dev/null
until docker exec "${DB}" pg_isready -U vliq -d vliq >/dev/null 2>&1; do sleep 1; done
say "restore into the copy…"
docker exec -i "${DB}" pg_restore -U vliq -d vliq --no-owner --exit-on-error < "${dump}"
docker pull -q "${BACKEND_IMAGE}" >/dev/null 2>&1 || docker image inspect "${BACKEND_IMAGE}" >/dev/null

if [[ -n "${REHEARSE_FROM:-}" ]]; then
  say "copy taken back to ${REHEARSE_FROM} (stage rehearsal)"
  alembic downgrade "${REHEARSE_FROM}" > "${OUT}/downgrade-prep.log" 2>&1
fi
start_rev="$(psql_copy -At -c 'SELECT version_num FROM public.alembic_version')"
say "schema of the copy: ${start_rev}"

# 3. Before → migrate (timed) → after → checks
fingerprint before
t0=$(date +%s)
alembic upgrade head > "${OUT}/upgrade.log" 2>&1 || { say "FAIL: alembic upgrade — see upgrade.log"; exit 1; }
say "upgrade head: $(( $(date +%s) - t0 )) s"
fingerprint after
psql_copy -At -F '|' < "${HERE}/invariants.sql" > "${OUT}/invariants.txt"
marked="$(psql_copy -At -c "SELECT count(DISTINCT receipt_id) FROM vliq.receipt_event WHERE data->>'migration' = '0014'")"

# 4. Reversible and re-runnable: down to the start, then up again — same data each time
alembic downgrade "${start_rev}" > "${OUT}/downgrade.log" 2>&1 || { say "FAIL: alembic downgrade — see downgrade.log"; exit 1; }
fingerprint down
alembic upgrade head > "${OUT}/upgrade2.log" 2>&1 || { say "FAIL: second upgrade — see upgrade2.log"; exit 1; }
fingerprint again

# 5. Verdict
env OUT="${OUT}" MARKED="${marked}" "${HERE}/compare.sh" | tee -a "${OUT}/log.txt"
