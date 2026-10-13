#!/usr/bin/env bash
# Nightly backup of the production database — independent of deploys.
#
# Verified dump (pg_restore --list) into .deploy/backups/nightly/, keep NIGHTLY_KEEP (default 30),
# then copy it OFF this server with BACKUP_UPLOAD_CMD (a backup on the same disk dies with the disk).
#
# cron on the production host (03:30 server time):
#   30 3 * * * cd /srv/VLIQ-things/VLIQ-Backend && BACKUP_UPLOAD_CMD='rclone copy {} vliq-backup:vliq-db/' \
#     ops/backup/nightly.sh >> .deploy/backups/nightly.log 2>&1
# {} in BACKUP_UPLOAD_CMD is replaced with the dump path. Where to store it is the owner's decision
# (docs/procedures/PROD-MIGRATION.md, «Защита базы»).
set -Eeuo pipefail

readonly OVERLAY="${DEPLOY_COMPOSE_OVERLAY:-docker-compose.test.yml}"
readonly -a COMPOSE=(docker compose -f docker-compose.yml -f "${OVERLAY}")
readonly DIR=".deploy/backups/nightly"
readonly KEEP="${NIGHTLY_KEEP:-30}"
mkdir -p "${DIR}"
chmod 700 "${DIR}"

file="${DIR}/$(date -u +%Y%m%dT%H%M%SZ).dump"
# shellcheck disable=SC2016  # expands inside the container
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${file}.partial"
if [[ ! -s "${file}.partial" ]] || ! "${COMPOSE[@]}" exec -T postgres pg_restore --list < "${file}.partial" > /dev/null; then
  rm -f "${file}.partial"
  echo "$(date -u +%FT%TZ) FAIL: dump is empty or unreadable" >&2
  exit 1
fi
mv "${file}.partial" "${file}"
chmod 600 "${file}"
find "${DIR}" -maxdepth 1 -name '*.dump' -printf '%T@ %p\n' | sort -rn | tail -n +"$((KEEP + 1))" | cut -d' ' -f2- | xargs -r rm -f
echo "$(date -u +%FT%TZ) OK ${file} ($(du -h "${file}" | cut -f1))"

if [[ -n "${BACKUP_UPLOAD_CMD:-}" ]]; then
  cmd="${BACKUP_UPLOAD_CMD//\{\}/${file}}"
  if bash -c "${cmd}"; then echo "$(date -u +%FT%TZ) uploaded off-host"; else echo "$(date -u +%FT%TZ) FAIL: upload" >&2; exit 1; fi
else
  echo "$(date -u +%FT%TZ) WARNING: BACKUP_UPLOAD_CMD is not set — the backup is only on this server" >&2
fi
