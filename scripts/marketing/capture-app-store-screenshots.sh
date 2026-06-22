#!/usr/bin/env bash
# Reproducibly capture the App Store screenshot set for Sirius (iOS), NATIVELY at
# the 6.5" iPhone size on an iPhone 15 Plus simulator.
#
# This is the single source of truth for regenerating the screenshots in
# app-store-assets/screenshots/iphone-6.5/ (1284 x 2778, the App Store 6.5" slot)
# and the marketing copies under apps/web/public/product/screens/. It drives the
# *installed* dev client on the "Sirius 6.5 Plus" simulator with agent-device,
# seeds a clean safe-for-work demo library (the same reviewer account used for App
# Review), gives every post a generated editorial cover, signs in, navigates the
# canonical screens — including the NEW onboarding ("How Sirius works") screen —
# and captures each at native 1290 x 2796, then normalizes to the exact 6.5"
# requirement (1284 x 2778) and asserts the size.
#
# WHY 6.5" NATIVE (not the old 6.9"+downscale): we capture on a real 6.5"-class
# device so the layout/typography is the device's own, then normalize the tiny
# aspect delta to Apple's accepted 1284 x 2778.
#
# THE EXPLORE MAP IS SUPPLIED, NOT AUTO-CAPTURED. The in-app Map is a focused
# drill view (one node + its links), so a fresh demo account renders it sparse.
# Point MAP_IMAGE at a hand-picked dense Map screenshot (any ~19.5:9 iPhone shot)
# and the script resizes it into the set. Without MAP_IMAGE the Map slot is
# skipped (a warning is printed) rather than shipping a thin auto-capture.
#
# PREREQUISITES (this script does NOT start them):
#   1. The dev stack is running so https://sirius.local APIs answer and Metro is up:
#        bun run dev          # full stack (web + worker + mobile/Metro on :8081)
#      A Sirius dev client build must exist in DerivedData (any `bun --cwd apps/mobile
#      ios` / `expo run:ios` run produces it) — the script installs it onto the sim.
#   2. A local DATABASE_URL (root .env) for the seed, and GEMINI_API_KEY for both the
#      seed's scene/taxonomy stage AND the editorial cover generator.
#   3. portless running (CA at ~/.portless/ca.pem) — the script trusts it on the sim
#      so the app's https://sirius.local API calls don't fail the TLS check.
#
# USAGE:
#   MAP_IMAGE=~/Downloads/map.png bun run app-store:screenshots
#   MAP_IMAGE=~/Downloads/map.png scripts/marketing/capture-app-store-screenshots.sh --teardown-first
#   scripts/marketing/capture-app-store-screenshots.sh --skip-seed          # reuse existing data/session
#   scripts/marketing/capture-app-store-screenshots.sh --skip-covers        # don't (re)generate covers
#   scripts/marketing/capture-app-store-screenshots.sh --map-only           # only re-slot MAP_IMAGE
#
# ENV (reviewer creds come from root .env automatically):
#   DEVICE            simulator name        (default "Sirius 6.5 Plus")
#   APP_ID            dev client bundle id  (default dev.copt.sirius)
#   SESSION           agent-device session  (default app-store)
#   REVIEWER_EMAIL    sign-in email         (default $DEV_REVIEWER_USER or reviewer@lesswhelmed.com)
#   REVIEWER_PASSWORD sign-in password      (default $DEV_REVIEWER_PASSWORD from .env)
#   MAP_IMAGE         path to a dense Map screenshot to resize into slot 07
#   SETTLE_MS         per-screen settle ms  (default 1500)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# --- Load reviewer creds from root .env (DEV_REVIEWER_* is the dev-only account) ---
# Pull just the two keys we need without sourcing the whole file (avoids surprises
# from quoted values / other vars).
env_val() { grep -E "^$1=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }
DEV_REVIEWER_USER="${DEV_REVIEWER_USER:-$(env_val DEV_REVIEWER_USER)}"
DEV_REVIEWER_PASSWORD="${DEV_REVIEWER_PASSWORD:-$(env_val DEV_REVIEWER_PASSWORD)}"

DEVICE="${DEVICE:-Sirius 6.5 Plus}"
DEVICE_TYPE="${DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-15-Plus}"
APP_ID="${APP_ID:-dev.copt.sirius}"
SESSION="${SESSION:-app-store}"
REVIEWER_EMAIL="${REVIEWER_EMAIL:-${DEV_REVIEWER_USER:-reviewer@lesswhelmed.com}}"
REVIEWER_PASSWORD="${REVIEWER_PASSWORD:-${DEV_REVIEWER_PASSWORD:-}}"
MAP_IMAGE="${MAP_IMAGE:-}"
SETTLE_MS="${SETTLE_MS:-1500}"
CA_PEM="${CA_PEM:-$HOME/.portless/ca.pem}"

# Native iPhone 15 Plus capture size, and the App Store 6.5" deliverable size.
NATIVE_W=1290 NATIVE_H=2796
SHOT_W=1284 SHOT_H=2778
OUT_DIR="$ROOT/app-store-assets/screenshots/iphone-6.5"
WEB_DIR="$ROOT/apps/web/public/product/screens"

SEED=1
COVERS=1
TEARDOWN_FIRST=0
STATUS_BAR=1
MAP_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --skip-seed) SEED=0 ;;
    --skip-covers) COVERS=0 ;;
    --teardown-first) TEARDOWN_FIRST=1 ;;
    --no-status-bar) STATUS_BAR=0 ;;
    --map-only) MAP_ONLY=1; SEED=0; COVERS=0 ;;
    -h | --help)
      sed -n '2,46p' "$0"
      exit 0
      ;;
    *)
      echo "unknown option: $arg (see --help)" >&2
      exit 2
      ;;
  esac
done

ad() { agent-device "$@" --session "$SESSION" --platform ios; }

# First @eN ref whose snapshot line matches the given extended-regex (empty if none).
ref() { ad snapshot -i 2>/dev/null | grep -E "$1" 2>/dev/null | grep -oE '@e[0-9]+' | head -1 || true; }
settle() { sleep "$(awk "BEGIN{print $SETTLE_MS/1000}")"; }

FAIL=0
# verify_dims <file> [w] [h] — defaults to the App Store 6.5" size.
verify_dims() {
  local f="$1" ew="${2:-$SHOT_W}" eh="${3:-$SHOT_H}" w h
  w="$(sips -g pixelWidth "$f" 2>/dev/null | awk '/pixelWidth/{print $2}')"
  h="$(sips -g pixelHeight "$f" 2>/dev/null | awk '/pixelHeight/{print $2}')"
  if [[ "$w" == "$ew" && "$h" == "$eh" ]]; then
    echo "  ✓ $(basename "$f") ${w}x${h}"
  else
    echo "  ✗ $(basename "$f") is ${w:-?}x${h:-?}, expected ${ew}x${eh}" >&2
    FAIL=1
  fi
}

# Capture the current screen natively into OUT_DIR/<name>, then normalize to 6.5".
shot() {
  local name="$1"
  settle
  xcrun simctl io booted screenshot "$OUT_DIR/$name" >/dev/null
  # Normalize native 1290x2796 -> App Store 6.5" 1284x2778 (≈0.2% scale, imperceptible).
  sips -z "$SHOT_H" "$SHOT_W" "$OUT_DIR/$name" >/dev/null 2>&1
  verify_dims "$OUT_DIR/$name"
}

# --- Preflight ----------------------------------------------------------------
command -v agent-device >/dev/null || { echo "error: agent-device not on PATH (need >= 0.14)." >&2; exit 1; }
command -v sips >/dev/null || { echo "error: sips not found (macOS only)." >&2; exit 1; }
mkdir -p "$OUT_DIR" "$WEB_DIR"

# --- Map-only fast path -------------------------------------------------------
slot_map() {
  if [[ -z "$MAP_IMAGE" ]]; then
    echo "⚠ MAP_IMAGE not set — skipping the Explore Map slot (07-explore-map)." >&2
    echo "  The in-app Map renders sparse on a demo account; pass MAP_IMAGE=<dense map png>." >&2
    return 0
  fi
  if [[ ! -f "$MAP_IMAGE" ]]; then
    echo "error: MAP_IMAGE '$MAP_IMAGE' does not exist." >&2
    FAIL=1; return 0
  fi
  echo "==> Slotting Map from $MAP_IMAGE"
  # Center crop-to-fill to the 6.5" aspect, then exact-resize. -c crops to the
  # given HxW (centered); -z then locks the exact pixel dims Apple validates.
  cp "$MAP_IMAGE" "$OUT_DIR/07-explore-map.png"
  sips -c "$SHOT_H" "$SHOT_W" "$OUT_DIR/07-explore-map.png" >/dev/null 2>&1
  sips -z "$SHOT_H" "$SHOT_W" "$OUT_DIR/07-explore-map.png" >/dev/null 2>&1
  verify_dims "$OUT_DIR/07-explore-map.png"
}

if [[ "$MAP_ONLY" == 1 ]]; then
  slot_map
  cp "$OUT_DIR/07-explore-map.png" "$WEB_DIR/07-explore-map.png" 2>/dev/null || true
  [[ "$FAIL" == 0 ]] && echo "✓ Map slot updated." || { echo "✗ Map slot failed." >&2; exit 1; }
  exit 0
fi

# --- Ensure the 6.5" simulator exists, is booted, dev client + CA installed ----
echo "==> Ensuring '$DEVICE' exists"
UDID="$(xcrun simctl list devices 2>/dev/null | grep -F "$DEVICE (" | grep -oE '[0-9A-F-]{36}' | head -1 || true)"
if [[ -z "$UDID" ]]; then
  RUNTIME="$(xcrun simctl list runtimes 2>/dev/null | grep -i 'iOS' | grep -oE 'com.apple.CoreSimulator.SimRuntime.iOS-[0-9-]+' | tail -1)"
  echo "    creating (type=$DEVICE_TYPE runtime=$RUNTIME)"
  UDID="$(xcrun simctl create "$DEVICE" "$DEVICE_TYPE" "$RUNTIME")"
fi
echo "    UDID=$UDID"
xcrun simctl list devices booted 2>/dev/null | grep -q "$UDID" || xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator
for _ in $(seq 1 60); do xcrun simctl list devices booted 2>/dev/null | grep -q "$UDID" && break; sleep 1; done

# Install the dev client if it isn't already on this sim.
if ! xcrun simctl get_app_container "$UDID" "$APP_ID" >/dev/null 2>&1; then
  APP="$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/Sirius-*/Build/Products/Debug-iphonesimulator/Sirius.app 2>/dev/null | head -1 || true)"
  [[ -n "$APP" ]] || { echo "error: no Sirius.app in DerivedData. Build it: bun --cwd apps/mobile ios" >&2; exit 1; }
  echo "==> Installing dev client: $APP"
  xcrun simctl install "$UDID" "$APP"
fi

# Trust the portless CA so the app's https://sirius.local API calls succeed.
if [[ -f "$CA_PEM" ]]; then
  echo "==> Trusting portless CA on the sim"
  xcrun simctl keychain "$UDID" add-root-cert "$CA_PEM" 2>/dev/null || true
else
  echo "⚠ $CA_PEM not found — the app may hit TLS errors against https://sirius.local." >&2
fi

if [[ "$STATUS_BAR" == 1 ]]; then
  echo "==> Applying clean status bar (9:41, full signal, 100%)"
  xcrun simctl status_bar "$UDID" override \
    --time "9:41" \
    --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 \
    --batteryState charged --batteryLevel 100 || true
fi

# --- Seed the demo library (16 posts) + generate editorial covers --------------
if [[ "$SEED" == 1 ]]; then
  [[ -n "$REVIEWER_PASSWORD" ]] || { echo "error: REVIEWER_PASSWORD/DEV_REVIEWER_PASSWORD unset; set it or pass --skip-seed." >&2; exit 1; }
  if [[ "$TEARDOWN_FIRST" == 1 ]]; then
    echo "==> Tearing down prior demo content (keeps the reviewer user)"
    bun run reviewer:seed --teardown --email "$REVIEWER_EMAIL" || true
  fi
  echo "==> Seeding reviewer library ($REVIEWER_EMAIL) — all demo posts + scene"
  bun run reviewer:seed --email "$REVIEWER_EMAIL" --password "$REVIEWER_PASSWORD"
fi

if [[ "$COVERS" == 1 ]]; then
  echo "==> Generating editorial cover images for every reviewer post"
  bun --cwd "$ROOT/apps/worker" run backfill:covers --user="$REVIEWER_EMAIL"
fi

# --- Launch the app + connect to Metro + sign in ------------------------------
# agent-device's XCUITest runner can only read the app once the JS bundle is
# rendered; while the Expo dev-client launcher is up it shows the runner splash.
# Flow that yields a CLEAN status bar (no "◀ AgentDeviceRunner" return chip):
#   1. agent-device open (binds the session + foregrounds the dev-client launcher)
#   2. tap the top "DEVELOPMENT SERVERS" row (it isn't in the a11y tree, so tap by
#      coordinate) — this connects to Metro and re-mounts the RN app, clearing any
#      return chip. We then poll with simctl screenshots (which DON'T steal focus;
#      an agent-device snapshot here would re-foreground the runner and stall load).
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || echo localhost)"
DEV_ROW_X=214 DEV_ROW_Y=189   # center of the first dev-server row on this device

connect_and_render() {
  xcrun simctl terminate "$UDID" "$APP_ID" >/dev/null 2>&1 || true
  sleep 1
  ad open "$APP_ID" --device "$DEVICE" >/dev/null 2>&1 || true
  sleep 4
  ad press "$DEV_ROW_X" "$DEV_ROW_Y" >/dev/null 2>&1 || true
  # Wait for the RN app shell (sign-in or tabs) via focus-safe screenshots.
  for _ in $(seq 1 25); do
    sleep 3
    xcrun simctl io booted screenshot /tmp/.ss-probe.png >/dev/null 2>&1 || true
    # The runner splash is tiny; once the RN bundle renders the a11y tree grows.
    local n; n="$(ad snapshot -i 2>/dev/null | grep -c '@e' || true)"
    [[ "${n:-0}" -gt 8 ]] && return 0
  done
  # Fallback: SpringBoard deep link to Metro (prompts "Open in Sirius?").
  xcrun simctl openurl "$UDID" "exp+sirius://expo-development-client/?url=http://$LAN_IP:8081" >/dev/null 2>&1 || true
  ad alert accept >/dev/null 2>&1 || true
  sleep 8
}

echo "==> Launching app + connecting to Metro ($LAN_IP:8081)"
connect_and_render

if ad is visible 'label="Sign in"' >/dev/null 2>&1 || ad is visible 'text="Sign in."' >/dev/null 2>&1; then
  [[ -n "$REVIEWER_PASSWORD" ]] || { echo "error: sign-in screen up but REVIEWER_PASSWORD unset." >&2; exit 1; }
  echo "==> Signing in as $REVIEWER_EMAIL"
  EMAIL_REF="$(ref '\[text-field\] "Email"')"
  PW_REF="$(ref '\[securetextfield\] "Password"')"
  [[ -n "$EMAIL_REF" ]] && ad fill "$EMAIL_REF" "$REVIEWER_EMAIL" --delay-ms 35 >/dev/null 2>&1 || true
  [[ -n "$PW_REF" ]] && ad fill "$PW_REF" "$REVIEWER_PASSWORD" --delay-ms 35 >/dev/null 2>&1 || true
  ad keyboard dismiss >/dev/null 2>&1 || true
  SIGNIN_REF="$(ref '\[button\] "Sign in"')"
  [[ -n "$SIGNIN_REF" ]] && ad press "$SIGNIN_REF" >/dev/null 2>&1 || true
  ad wait 'label="Capture"' 20000 >/dev/null 2>&1 || ad wait 'label="Catalog"' 20000 >/dev/null 2>&1 || true
fi

# After sign-in, do ONE more clean reload so the status bar has no return chip and
# the offline mirror has synced all posts before we navigate + capture.
echo "==> Clean reload (clears return chip, syncs library)"
connect_and_render
ad wait 'label="Catalog"' 20000 >/dev/null 2>&1 || true

# --- Capture the canonical screens --------------------------------------------
# After the clean reload, navigating with `ad press` does NOT re-introduce the
# return chip, so every shot stays clean.
echo "==> Capturing screens"

press_tab() { local r; r="$(ref "\\[button\\] \"$1\"")"; [[ -n "$r" ]] && ad press "$r" >/dev/null 2>&1 || true; }

echo "-> 02 Capture"
press_tab "Capture"
shot "02-capture.png"

echo "-> 01 Onboarding (How Sirius works)"
HOW_REF="$(ref 'How it works')"
if [[ -n "$HOW_REF" ]]; then
  ad press "$HOW_REF" >/dev/null 2>&1 || true
  shot "01-onboarding.png"
  # Dismiss the pushed help screen so the tab bar is back for the rest.
  ad scroll down 2000 >/dev/null 2>&1 || true
  GOT_REF="$(ref 'Got it')"
  [[ -n "$GOT_REF" ]] && ad press "$GOT_REF" >/dev/null 2>&1 || ad back >/dev/null 2>&1 || true
  settle
else
  echo "  ⚠ 'How it works' link not found; skipping onboarding." >&2
fi

echo "-> 03 Catalog"
press_tab "Catalog"
shot "03-catalog.png"

echo "-> 05 Post detail (Ridge Trail — SIGHT w/ hero image)"
press_tab "Catalog"
settle
POST_REF="$(ref 'Ridge Trail')"
[[ -z "$POST_REF" ]] && POST_REF="$(ref 'Sourdough')"
if [[ -n "$POST_REF" ]]; then
  ad press "$POST_REF" >/dev/null 2>&1 || true
  shot "05-post-detail.png"
  ad back >/dev/null 2>&1 || true
  settle
fi

echo "-> 04 Queue"
press_tab "Queue"
shot "04-queue.png"

echo "-> 06 Explore / Categories"
press_tab "Explore"
settle
CAT_REF="$(ref 'Categories')"
[[ -n "$CAT_REF" ]] && ad press "$CAT_REF" >/dev/null 2>&1 || true
shot "06-explore-categories.png"

echo "-> 07 Explore / Map (from MAP_IMAGE)"
slot_map

# --- Sync into the marketing public dir ---------------------------------------
# The marketing site (apps/web/app/(marketing)/constants.ts) references its own
# fixed filenames, which differ from the App Store set. Map App-Store → marketing
# names so re-running refreshes the marketing hero shots without orphan files.
# (Onboarding has no marketing slot today, so it is intentionally not mirrored.)
echo "==> Syncing into apps/web/public/product/screens/ (marketing names)"
declare -a WEB_MAP=(
  "02-capture:01-capture"
  "03-catalog:02-catalog"
  "04-queue:03-queue"
  "06-explore-categories:04-tree"
  "05-post-detail:05-post-detail"
  "07-explore-map:06-explore"
)
for pair in "${WEB_MAP[@]}"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  [[ -f "$OUT_DIR/$src.png" ]] && cp "$OUT_DIR/$src.png" "$WEB_DIR/$dst.png" || true
done

ad close >/dev/null 2>&1 || true

echo
if [[ "$FAIL" == 0 ]]; then
  echo "✓ Done. App Store 6.5\" set (1284x2778) in $OUT_DIR (mirrored to $WEB_DIR)."
else
  echo "✗ One or more screenshots failed their size check — re-run after fixing." >&2
  exit 1
fi
