#!/usr/bin/env bash
# Sign in as the test user. Leaves the agent-browser session ($TEST_SESSION)
# authenticated and parked on /ingest. Re-runnable.

source "$(dirname "$0")/_lib.sh"
require_cmd agent-browser

log "opening $BASE_URL/sign-in"
ab open "$BASE_URL/sign-in" >/dev/null

current_url="$(ab get url)"
if [[ "$current_url" != *"/sign-in"* ]]; then
  log "already signed in — current url: $current_url"
  exit 0
fi

log "waiting for sign-in form"
ab_wait '#email' >/dev/null

log "filling email + password"
ab fill '#email' "$TEST_EMAIL" >/dev/null
ab fill '#password' "$TEST_PASSWORD" >/dev/null

log "submitting"
ab find text "Sign in" click --exact >/dev/null

log "waiting for redirect to /ingest"
ab_wait_url "/ingest" 15

log "signed in. landed on $(ab get url)"
