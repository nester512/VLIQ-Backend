#!/usr/bin/env bash
set -Eeuo pipefail

: "${IMAGE_TAG:?IMAGE_TAG must contain the Git commit SHA to deploy}"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-vliq-backend}"
export BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/nester512/vliq-backend}"
export FRONTEND_IMAGE="${FRONTEND_IMAGE:-ghcr.io/nester512/vliq-frontend}"

readonly HEALTH_URL="${DEPLOY_HEALTH_URL:-https://shamilara.fun/health}"
readonly STATE_DIR=".deploy"
readonly CURRENT_TAG_FILE="${STATE_DIR}/current-image-tag"
readonly -a COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.test.yml)
readonly -a APP_SERVICES=(backend bot notifications-worker receipt-pipeline-worker frontend)

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

"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" pull "${APP_SERVICES[@]}"

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

if ! curl --fail --silent --show-error --max-time 15 "${HEALTH_URL}" >/dev/null; then
  echo "Public health-check failed: ${HEALTH_URL}" >&2
  "${COMPOSE[@]}" logs --tail=100 backend caddy >&2 || true
  rollback || true
  exit 1
fi

printf '%s\n' "${IMAGE_TAG}" > "${CURRENT_TAG_FILE}"
echo "Test stand successfully deployed: ${IMAGE_TAG}"
