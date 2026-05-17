#!/usr/bin/env bash
# Poll the DB until an IngestSubmission reaches a terminal state. Prints the
# final status on stdout; exits non-zero if the timeout fires or the row ends
# in `failed` / `skipped`.
#
# Usage: ./wait-completed.sh <submission_id> [timeout_seconds=120]

source "$(dirname "$0")/_lib.sh"
require_cmd psql

submission_id="${1:-}"
timeout_sec="${2:-120}"

if [ -z "$submission_id" ]; then
  echo "usage: $0 <submission_id> [timeout_seconds]" >&2
  exit 2
fi

deadline=$(( $(date +%s) + timeout_sec ))
last_state=""

while [ "$(date +%s)" -lt "$deadline" ]; do
  row="$(psql_q "SELECT status || '|' || COALESCE(\"resultPostSlug\", '') || '|' || COALESCE(\"errorMessage\", '') FROM \"IngestSubmission\" WHERE id = '$submission_id';")"
  if [ -z "$row" ]; then
    echo "[error] no IngestSubmission with id=$submission_id" >&2
    exit 1
  fi
  status="${row%%|*}"
  rest="${row#*|}"
  slug="${rest%%|*}"
  err="${rest#*|}"

  if [ "$status" != "$last_state" ]; then
    log "status=$status slug=$slug${err:+ err=$err}"
    last_state="$status"
  fi

  case "$status" in
    completed)
      echo "completed:$slug"
      exit 0
      ;;
    failed|skipped)
      echo "$status:$err" >&2
      exit 1
      ;;
  esac

  sleep 2
done

echo "[error] timeout after ${timeout_sec}s — last status=$last_state" >&2
exit 1
