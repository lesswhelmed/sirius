#!/usr/bin/env bash
# Submit one URL through the ingest composer. Requires an authenticated
# session (run signin.sh first). Prints the new IngestSubmission id on stdout.
#
# Usage: ./submit-url.sh <URL>

source "$(dirname "$0")/_lib.sh"
require_cmd agent-browser psql

url="${1:-}"
if [ -z "$url" ]; then
  echo "usage: $0 <url>" >&2
  exit 2
fi

log "navigating to /ingest"
ab open "$BASE_URL/ingest" >/dev/null
ab_wait --text "What did you find?" >/dev/null

before_id="$(psql_q "SELECT id FROM \"IngestSubmission\" ORDER BY \"createdAt\" DESC LIMIT 1;")"

log "filling composer with $url"
ab fill 'textarea[aria-label="Content input"]' "$url" >/dev/null
ab find text "Send to press" click >/dev/null

# Wait until a new row lands. Composer also clears the textbox on success.
for _ in {1..20}; do
  sleep 0.5
  latest_id="$(psql_q "SELECT id FROM \"IngestSubmission\" ORDER BY \"createdAt\" DESC LIMIT 1;")"
  if [ -n "$latest_id" ] && [ "$latest_id" != "$before_id" ]; then
    log "submitted: $latest_id"
    echo "$latest_id"
    exit 0
  fi
done

echo "[error] no new IngestSubmission row appeared within 10s" >&2
exit 1
