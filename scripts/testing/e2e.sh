#!/usr/bin/env bash
# Full end-to-end loop: bootstrap (if needed) → signin → submit → wait → verify.
# Mirrors the manual run from 2026-05-17.
#
# Usage: ./e2e.sh [URL]
#   URL defaults to a stable Wikipedia page.

source "$(dirname "$0")/_lib.sh"
require_cmd agent-browser psql

url="${1:-https://en.wikipedia.org/wiki/Markdown}"

log "step 1/4 — bootstrap test user"
"$SCRIPT_DIR/bootstrap-user.sh"

log "step 2/4 — sign in"
"$SCRIPT_DIR/signin.sh"

log "step 3/4 — submit $url"
submission_id="$("$SCRIPT_DIR/submit-url.sh" "$url" | tail -n 1)"

log "step 4/4 — wait for completion (id=$submission_id)"
result="$("$SCRIPT_DIR/wait-completed.sh" "$submission_id" 180 | tail -n 1)"
slug="${result#completed:}"

log "verifying post $slug"
"$SCRIPT_DIR/verify-post.sh" "$slug"

log "e2e PASS — id=$submission_id slug=$slug"
