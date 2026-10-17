#!/bin/sh
# QR regression: a dataset of receipt photos / PDFs through the seller app's own QR code.
# Usage (repo root):  sh ops/regression/qr/run.sh <dataset dir with regression.csv> [out dir]
#   LIMIT=50 sh ops/regression/qr/run.sh …   — first 50 files (smoke of the harness itself)
# Starts a Vite dev server (node:26) for the harness page, runs Playwright, stops the server.
# A dataset of REAL receipts stays where it is allowed to be; the output is counts + path/verdict only.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
DATASET=$(cd "$1" && pwd)
OUT=${2:-"$HERE/out"}
mkdir -p "$OUT"
NAME=vliq-qr-harness-vite
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -m 1g --network host -v "$ROOT/frontend:/app" -w /app node:26-alpine \
  npx vite --host 127.0.0.1 --port 5179 --strictPort >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
i=0; until wget -q -O /dev/null http://127.0.0.1:5179/qr-regression.html 2>/dev/null || [ $i -ge 60 ]; do i=$((i+1)); sleep 1; done
docker run --rm -m 1500m --ipc=host --network host -e DATASET=/data -e OUT=/out -e LIMIT -e ONLY \
  -v "$ROOT/frontend:/app:ro" -v "$HERE:/harness:ro" -v "$DATASET:/data:ro" -v "$OUT:/out" \
  mcr.microsoft.com/playwright:v1.64.0-noble node /harness/run.mjs 2>&1 | grep -v WARNING
