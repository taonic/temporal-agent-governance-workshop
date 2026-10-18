#!/usr/bin/env bash
# The runner behind an ngrok tunnel, so Daytona sandboxes can reach its model passthrough
# (/llm/v1) from a local runner. Starts ngrok, waits for its public URL, runs the runner with
# PUBLIC_URL set, and stops ngrok when the runner exits. Restart your sandbox afterwards so its
# .env gets the new URL.
set -euo pipefail
cd "$(dirname "$0")"

if pgrep -x ngrok >/dev/null; then
  echo "ngrok is already running; stop it first (pkill ngrok)" >&2
  exit 1
fi

PORT="${PORT:-8787}"
ngrok http "$PORT" >/dev/null &
NGROK_PID=$!
trap 'kill $NGROK_PID 2>/dev/null || true' EXIT INT TERM

URL=""
for _ in $(seq 1 40); do
  URL=$(curl -s localhost:4040/api/tunnels |
    python3 -c 'import sys,json;print(json.load(sys.stdin)["tunnels"][0]["public_url"])' 2>/dev/null) && break
  sleep 0.5
done
if [ -z "$URL" ]; then
  echo "ngrok didn't come up on localhost:4040" >&2
  exit 1
fi

echo "PUBLIC_URL=$URL"
PUBLIC_URL="$URL" PORT="$PORT" npm run runner
