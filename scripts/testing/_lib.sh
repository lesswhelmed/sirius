# Sourced by every script in scripts/testing/. Loads creds and exposes
# helpers for agent-browser + psql. Do not execute directly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ ! -f "$SCRIPT_DIR/.creds.local" ]; then
  echo "[error] $SCRIPT_DIR/.creds.local missing. Copy creds.example.sh to .creds.local and fill it in." >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$SCRIPT_DIR/.creds.local"

# Load repo .env (DATABASE_URL etc.) for psql helpers below.
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

# Prisma encodes a `schema=public` query param that psql refuses to parse.
psql_url() {
  echo "${DATABASE_URL:-}" | sed -E 's/[?&]schema=[^&]*//'
}

# psql_q "SELECT ...;"  → tab-separated, no header, no row count.
psql_q() {
  psql "$(psql_url)" -At -F $'\t' -c "$1"
}

ab() {
  agent-browser --session "$TEST_SESSION" "$@"
}

# Wait for an element by snapshot ref, role, or text. Defaults to 15s.
ab_wait() {
  agent-browser --session "$TEST_SESSION" wait "$@"
}

# Poll the browser's current URL until it contains a substring. Avoids
# `wait --url` which only fires on navigation events — it hangs if the
# navigation already completed before the wait started.
#
# Usage: ab_wait_url <substring> [timeout_seconds=15]
ab_wait_url() {
  local needle="$1"
  local timeout="${2:-15}"
  local deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local current
    current="$(agent-browser --session "$TEST_SESSION" get url 2>/dev/null || true)"
    if [[ "$current" == *"$needle"* ]]; then
      return 0
    fi
    sleep 0.5
  done
  echo "[error] url never matched '$needle' (last: $current)" >&2
  return 1
}

require_cmd() {
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "[error] required command not found: $cmd" >&2
      exit 1
    fi
  done
}

log() { echo "[$(date +%H:%M:%S)] $*"; }
