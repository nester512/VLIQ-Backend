#!/usr/bin/env bash
set -Eeuo pipefail

: "${IMAGE_TAG:?IMAGE_TAG must contain the Git commit SHA to deploy}"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-vliq-backend}"
export BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/nester512/vliq-backend}"
export FRONTEND_IMAGE="${FRONTEND_IMAGE:-ghcr.io/nester512/vliq-frontend}"

# Defaults describe production (shamilara.fun). The stage deploy overrides them:
#   COMPOSE_PROJECT_NAME=vliq-stage DEPLOY_COMPOSE_OVERLAY=docker-compose.stage.yml \
#   DEPLOY_HEALTH_URL=https://<stage-host>/health IMAGE_TAG=<sha> ./ops/deploy.sh
readonly HEALTH_URL="${DEPLOY_HEALTH_URL:-https://shamilara.fun/health}"
readonly COMPOSE_OVERLAY="${DEPLOY_COMPOSE_OVERLAY:-docker-compose.test.yml}"
readonly STATE_DIR=".deploy"
readonly CURRENT_TAG_FILE="${STATE_DIR}/current-image-tag"
readonly -a COMPOSE=(docker compose -f docker-compose.yml -f "${COMPOSE_OVERLAY}")
readonly -a APP_SERVICES=(backend bot notifications-worker receipt-pipeline-worker frontend)
readonly BACKUP_DIR="${STATE_DIR}/backups"
readonly BACKUP_KEEP="${DEPLOY_BACKUP_KEEP:-14}"

mkdir -p "${STATE_DIR}"
previous_tag=""
if [[ -f "${CURRENT_TAG_FILE}" ]]; then
  previous_tag="$(tr -d '[:space:]' < "${CURRENT_TAG_FILE}")"
fi

rollback() {
  if [[ -z "${previous_tag}" || "${previous_tag}" == "${IMAGE_TAG}" ]]; then
    echo "No previous image tag is recorded; automatic rollback is unavailable." >&2
    return 1
  fi

  echo "Deployment failed; rolling application services back to ${previous_tag}." >&2
  export IMAGE_TAG="${previous_tag}"
  "${COMPOSE[@]}" pull "${APP_SERVICES[@]}"
  "${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 180 "${APP_SERVICES[@]}" caddy
}

# Data safety: a verified dump of the database is taken BEFORE every migration.
# No backup → no migration → nothing changes (the deploy stops here).
# Restore: docs/CI-CD.md «Восстановление из бэкапа».
backup_database() {
  if ! "${COMPOSE[@]}" ps --status running --services | grep -qx postgres; then
    echo "Postgres is not running yet (first deploy?) — nothing to back up." >&2
    return 0
  fi
  mkdir -p "${BACKUP_DIR}"
  chmod 700 "${BACKUP_DIR}"
  local file
  file="${BACKUP_DIR}/$(date -u +%Y%m%dT%H%M%SZ)-${IMAGE_TAG:0:12}.dump"
  # pg_dump of the running server's own major version, custom format (pg_restore-able).
  # shellcheck disable=SC2016  # $POSTGRES_* expand inside the container, on purpose
  if ! "${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${file}.partial"; then
    rm -f "${file}.partial"
    return 1
  fi
  # A backup that cannot be read is not a backup.
  if [[ ! -s "${file}.partial" ]] \
    || ! "${COMPOSE[@]}" exec -T postgres pg_restore --list < "${file}.partial" > /dev/null; then
    rm -f "${file}.partial"
    return 1
  fi
  mv "${file}.partial" "${file}"
  chmod 600 "${file}"
  # Keep the newest BACKUP_KEEP dumps.
  find "${BACKUP_DIR}" -maxdepth 1 -name '*.dump' -printf '%T@ %p\n' | sort -rn \
    | tail -n +"$((BACKUP_KEEP + 1))" | cut -d' ' -f2- | xargs -r rm -f
  echo "Database backup: ${file} ($(du -h "${file}" | cut -f1))"
}

"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" pull "${APP_SERVICES[@]}"

if ! backup_database; then
  echo "Database backup failed; migrations were not run and containers were not switched." >&2
  exit 1
fi

# The migration runs before any long-lived application container switches to
# the new image. Migrations deployed to this environment must be backward
# compatible because an image rollback does not downgrade the database.
if ! "${COMPOSE[@]}" run --rm backend alembic upgrade head; then
  echo "Alembic failed; running application containers were not switched." >&2
  exit 1
fi

if ! "${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 180; then
  "${COMPOSE[@]}" ps >&2 || true
  "${COMPOSE[@]}" logs --tail=100 backend caddy >&2 || true
  rollback || true
  exit 1
fi

# Caddy mounts Caddyfile from the checkout. Compose does not recreate a running
# container when only the contents of a bind-mounted file change, so explicitly
# recreate the proxy before probing public routes such as /health and /storage.
if ! "${COMPOSE[@]}" up -d --force-recreate --no-deps caddy; then
  "${COMPOSE[@]}" logs --tail=100 caddy >&2 || true
  rollback || true
  exit 1
fi

health_body=""
if ! health_body="$(curl --fail --silent --show-error --max-time 5 \
  --retry 10 --retry-connrefused --retry-delay 2 --retry-max-time 30 "${HEALTH_URL}")" \
  || [[ "${health_body}" != '{"result":"ok"}' ]]; then
  echo "Public health-check failed: ${HEALTH_URL}" >&2
  echo "Unexpected response: ${health_body:-<empty>}" >&2
  "${COMPOSE[@]}" logs --tail=100 backend caddy >&2 || true
  rollback || true
  exit 1
fi

printf '%s\n' "${IMAGE_TAG}" > "${CURRENT_TAG_FILE}"
echo "${COMPOSE_PROJECT_NAME} successfully deployed: ${IMAGE_TAG}"
