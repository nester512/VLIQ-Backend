#!/bin/sh
# R-L-D*: every screen on 20 device sizes in Chromium, WebKit and Firefox — one browser at a time
# (shared host). Usage (repo root): sh ops/regression/ui/devices.sh [ADMIN_TG_ID] [SELLER_TG_ID]
# ENGINES="chromium" ONLY=laptop — a subset. Synthetic stage accounts only; screenshots go to ops/regression/ui/out/shots (gitignored).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
OUT="$HERE/out"
mkdir -p "$OUT/shots"
cp "$HERE/lib.mjs" "$HERE/devices.mjs" "$OUT/"
rm -f "$OUT"/devices-*.jsonl
docker exec -i vliq-backend python - "${1:-70000099}" "${2:-70000002}" < "$HERE/sign_initdata.py" > "$OUT/initdata.json"
status=0
for engine in ${ENGINES:-chromium webkit firefox}; do
  rc=0
  docker run --rm -m 1500m --ipc=host --network host -e ENGINE=$engine -e ONLY="$ONLY" -v "$ROOT/frontend:/app:ro" -v "$OUT:/out" \
    mcr.microsoft.com/playwright:v1.64.0-noble node /out/devices.mjs > "$OUT/devices-$engine.log" 2>&1 || rc=$?
  grep -v WARNING "$OUT/devices-$engine.log" | grep -v '^ok' || true
  [ $rc -eq 0 ] || status=1
done
rm -f "$OUT/initdata.json"
exit $status
