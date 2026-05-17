#!/usr/bin/env bash
# Close the agent-browser test session. Optionally pass --delete-user to
# also DELETE the test user from the DB (cascades to account + sessions).
#
# Usage: ./teardown.sh [--delete-user]

source "$(dirname "$0")/_lib.sh"
require_cmd agent-browser

log "closing agent-browser session $TEST_SESSION"
agent-browser --session "$TEST_SESSION" close >/dev/null 2>&1 || true

if [ "${1:-}" = "--delete-user" ]; then
  require_cmd psql
  log "deleting user $TEST_EMAIL"
  psql_q "DELETE FROM \"user\" WHERE email = '$TEST_EMAIL';" >/dev/null
  log "user deleted"
fi

log "done"
