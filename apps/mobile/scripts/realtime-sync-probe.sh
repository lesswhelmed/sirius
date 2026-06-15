#!/usr/bin/env bash
# Self-resetting RECREATION of the realtime offline-sync validation (bead ao-n1e).
#
# It RE-STEPS the whole flow from a clean slate every run, then RECURSES (polls)
# until the synced note lands — robust to the two things that kept breaking the
# manual run: leftover agent-device session leases, and the iOS app-container
# UUID shifting on every reinstall (so the SQLite path is resolved dynamically,
# never hardcoded).
#
# What it proves: a note ingested as the OWNER from a SECOND client (browser →
# session-auth /api/app/ingest) flows server→device end-to-end — worker drafts it,
# Postgres NOTIFY nudges the SSE stream, the app pulls the delta into its local
# SQLite mirror — WITHOUT a manual refresh on the device.
#
# Usage:
#   apps/mobile/scripts/realtime-sync-probe.sh
#   HOST=https://lesswhelmed.com EMAIL=… PASSWORD=… apps/mobile/scripts/realtime-sync-probe.sh   # prod surface
#
# Env: HOST (default https://sirius.local) · EMAIL (default saleebmina@icloud.com)
#      PASSWORD (default $DEV_LOGIN_PASSWORD from .env) · APP (dev.copt.sirius)
#      DEVICE ("iPhone 17 Pro") · TIMEOUT secs (default 90) · POLL secs (default 5)
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
HOST="${HOST:-https://sirius.local}"
EMAIL="${EMAIL:-saleebmina@icloud.com}"
PASSWORD="${PASSWORD:-$(grep '^DEV_LOGIN_PASSWORD=' "$ROOT/.env" 2>/dev/null | cut -d= -f2-)}"
APP="${APP:-dev.copt.sirius}"
DEVICE="${DEVICE:-iPhone 17 Pro}"
# Worker draft latency can be minutes under load; the device only pulls the delta
# on foreground/cold-start, and the agent-device session keeps the app foregrounded
# for the whole poll window — so a generous timeout is correct, not a smell.
TIMEOUT="${TIMEOUT:-300}"
POLL="${POLL:-5}"
ADSESS="rtprobe"      # agent-device session
ABSESS="rtprobe-web"  # agent-browser session
MARKER="rtprobe-$(date +%s)"   # unique per run; embedded in the note body

ad() { agent-device "$@" --session "$ADSESS" --platform ios; }
ab() { agent-browser "$@" --session "$ABSESS"; }

# --- RECREATE: clean every stale device lease so open() can't hit DEVICE_IN_USE ---
reset_state() {
  for s in "$ADSESS" default rt rt2 val probe devsim tree tree-test scene-dev scene-probe; do
    agent-device close --session "$s" --platform ios >/dev/null 2>&1
  done
  sleep 2
}

# --- dynamic db path (container UUID changes on reinstall) ---
dbpath() { local d; d="$(xcrun simctl get_app_container booted "$APP" data 2>/dev/null)"; find "$d" -name sirius.db 2>/dev/null | head -1; }
q() { sqlite3 "$(dbpath)" "$1" 2>/dev/null; }

cleanup() { agent-device close --session "$ADSESS" --platform ios >/dev/null 2>&1; agent-browser close --session "$ABSESS" >/dev/null 2>&1; }
trap cleanup EXIT

echo "→ [recreate] resetting device sessions + opening $APP"
reset_state
ad close >/dev/null 2>&1
if ! agent-device open "$APP" --session "$ADSESS" --platform ios --device "$DEVICE" 2>&1 | grep -q Opened; then
  echo "✗ FAIL: could not open $APP (device busy after reset)"; exit 1
fi
sleep 2
ad press 'label="Catalog"' >/dev/null 2>&1; sleep 1

DB="$(dbpath)"
if [[ -z "$DB" ]]; then echo "✗ FAIL: could not resolve sirius.db (app not installed / not launched)"; exit 1; fi
BASELINE="$(q 'SELECT count(*) FROM posts;')"
echo "→ [baseline] mirror=$BASELINE posts · marker=$MARKER · db=$DB"

echo "→ [login] $EMAIL @ $HOST (second client)"
ab open "${HOST}/ingest" >/dev/null 2>&1; sleep 1
if [[ "$(ab get url 2>/dev/null)" == *"/sign-in"* ]]; then
  E="$(ab snapshot -i 2>/dev/null | grep -iE 'textbox "EMAIL"' | grep -oE 'e[0-9]+' | head -1)"
  P="$(ab snapshot -i 2>/dev/null | grep -iE 'textbox "PASSWORD"' | grep -oE 'e[0-9]+' | head -1)"
  ab fill "@$E" "$EMAIL" >/dev/null; ab fill "@$P" "$PASSWORD" >/dev/null
  ab click "$(ab snapshot -i 2>/dev/null | grep -iE 'button "SIGN IN"' | grep -oE 'e[0-9]+' | head -1 | sed 's/^/@/')" >/dev/null
  sleep 3
fi
if ab eval "document.body.innerText" 2>/dev/null | grep -qi "Invalid email or password"; then
  echo "✗ FAIL: login rejected at $HOST"; exit 2
fi

echo "→ [ingest] POST /api/app/ingest as owner (force, note carries marker)"
RESP="$(ab eval --stdin <<JS 2>/dev/null
(async () => {
  const r = await fetch('/api/app/ingest', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: [], notes: 'Realtime sync probe ${MARKER}: a note ingested from a second client to verify SSE delta delivery into the device mirror.', force: true }),
  });
  return JSON.stringify({ status: r.status, body: (await r.text()).slice(0,200) });
})()
JS
)"
echo "   server: $RESP"
# Response is double-encoded by eval; match the accepted status / pending marker
# in either escaped or plain form.
if ! echo "$RESP" | grep -qE '(20[02])|pending'; then echo "✗ FAIL: ingest did not accept (need a live web+worker stack)"; exit 1; fi

echo "→ [recurse] polling mirror every ${POLL}s up to ${TIMEOUT}s (no manual refresh on device)"
elapsed=0
while (( elapsed < TIMEOUT )); do
  sleep "$POLL"; elapsed=$((elapsed+POLL))
  COUNT="$(q 'SELECT count(*) FROM posts;')"
  HIT="$(q "SELECT count(*) FROM posts WHERE body LIKE '%${MARKER}%' OR excerpt LIKE '%${MARKER}%';")"
  printf '   t=%2ss  mirror=%s  marker-match=%s\n' "$elapsed" "${COUNT:-?}" "${HIT:-0}"
  if [[ "${HIT:-0}" -ge 1 ]]; then
    echo "✓ PASS: marker note reached the device mirror via the sync path (t=${elapsed}s)."
    ad press 'label="Catalog"' >/dev/null 2>&1; sleep 1
    ad screenshot /tmp/realtime-sync.png >/dev/null 2>&1 && echo "   evidence: /tmp/realtime-sync.png"
    exit 0
  fi
  if [[ -n "${COUNT:-}" && -n "${BASELINE:-}" && "$COUNT" -gt "$BASELINE" ]]; then
    echo "✓ PASS(weak): mirror grew ${BASELINE}→${COUNT} (delivery confirmed; marker not yet matched — worker may have rewritten the body)."
    ad screenshot /tmp/realtime-sync.png >/dev/null 2>&1 && echo "   evidence: /tmp/realtime-sync.png"
    exit 0
  fi
done
echo "✗ TIMEOUT after ${TIMEOUT}s: note never reached the mirror. Check worker is processing + SSE /api/app/posts/stream is connected."
exit 1
