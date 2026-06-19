#!/usr/bin/env bash
# Host-side dev stack for WIRELESS (adb-reverse) mobile dev: web + worker, NO portless.
#
# The normal `web` dev task runs behind portless (binds :443, needs sudo+TTY) so the app
# can reach https://sirius.local. The wireless path doesn't use that — `wireless-run.sh`
# sets up `adb reverse tcp:3000` so the phone reaches the web app at plain
# http://localhost:3000. So here we run `next dev` directly (port 3000) + the worker,
# with no proxy and no sudo prompt.
#
# Usage: bun run dev:wireless:host   (or: bash scripts/dev-wireless-host.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Kill both children when this script exits / is Ctrl-C'd.
cleanup() { trap - EXIT INT TERM; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "==> worker (background)…"
( cd "$ROOT/apps/worker" && bun run dev ) &

echo "==> web: next dev on http://localhost:3000 (no portless; reachable on the phone via adb reverse)…"
( cd "$ROOT/apps/web" && bun run dev:app ) &

wait
