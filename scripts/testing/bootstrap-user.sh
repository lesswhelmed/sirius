#!/usr/bin/env bash
# One-time: create the test user via /sign-up, then UPDATE emailVerified=true
# directly because Resend rejects sends to unverified recipients in dev/testing
# mode. Idempotent — re-running on an existing user just re-flips the flag.

source "$(dirname "$0")/_lib.sh"
require_cmd agent-browser psql

existing="$(psql_q "SELECT id FROM \"user\" WHERE email = '$TEST_EMAIL';")"

if [ -z "$existing" ]; then
  log "no user for $TEST_EMAIL — signing up via /sign-up"
  ab open "$BASE_URL/sign-up" >/dev/null
  ab_wait '#name' >/dev/null
  ab fill '#name' "$TEST_NAME" >/dev/null
  ab fill '#email' "$TEST_EMAIL" >/dev/null
  ab fill '#password' "$TEST_PASSWORD" >/dev/null
  ab find text "Create account" click --exact >/dev/null
  ab_wait_url "/verify-email" 15
  log "sign-up succeeded; user row created (verification email may have failed — that's OK)"
else
  log "user $TEST_EMAIL already exists (id=$existing)"
fi

log "marking emailVerified=true via direct UPDATE"
psql_q "UPDATE \"user\" SET \"emailVerified\" = true, \"updatedAt\" = NOW() WHERE email = '$TEST_EMAIL';" >/dev/null

log "done. user ready for signin.sh"
