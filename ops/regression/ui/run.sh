#!/bin/sh
# UI regression on the STAGE: layout of every screen (R-L-*) and «назад» (R-B-*).
# Usage (repo root): sh ops/regression/ui/run.sh [ADMIN_TG_ID] [SELLER_TG_ID]
# Synthetic stage accounts only; screenshots go to ops/regression/ui/out/shots (gitignored).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
OUT="$HERE/out"
mkdir -p "$OUT/shots"
cp "$HERE/lib.mjs" "$HERE/layout.mjs" "$HERE/back.mjs" "$OUT/"
docker exec -i vliq-backend python - "${1:-70000099}" "${2:-70000002}" < "$HERE/sign_initdata.py" > "$OUT/initdata.json"
run() {
  rc=0
  docker run --rm -m 1g --ipc=host --network host -v "$ROOT/frontend:/app:ro" -v "$OUT:/out" \
    mcr.microsoft.com/playwright:v1.64.0-noble node "/out/$1" > "$OUT/$1.log" 2>&1 || rc=$?
  grep -v WARNING "$OUT/$1.log"
  return $rc
}
status=0
run layout.mjs || status=1
run back.mjs || status=1
rm -f "$OUT/initdata.json"
exit $status
