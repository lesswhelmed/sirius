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
#   APPEARANCE        light|dark sim appearance (default light — the shipped look)
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
# NOTE: the default snapshot truncates around 300 nodes — with a large library the
# tab bar never makes it into this output. Use tab_ref for tab presses.
ref() { ad snapshot -i 2>/dev/null | grep -E "$1" 2>/dev/null | grep -oE '@e[0-9]+' | head -1 || true; }
settle() { sleep "$(awk "BEGIN{print $SETTLE_MS/1000}")"; }

# Tab-bar-scoped ref — immune to the snapshot truncation above (the 2026-07-10
# all-identical-screenshots regression: every press_tab silently no-oped).
tab_ref() { ad snapshot -s "Tab Bar" 2>/dev/null | grep -E "\[button\] \"$1\"" | grep -oE '@e[0-9]+' | head -1 || true; }

# press_tab <TabName> — hard-fails instead of silently screenshotting the wrong screen.
press_tab() {
  local name="$1" r
  for _ in 1 2 3; do
    r="$(tab_ref "$name")"
    if [[ -n "$r" ]]; then
      ad press "$r" >/dev/null 2>&1 && return 0
    fi
    sleep 2
  done
  echo "error: tab '$name' not found in the Tab Bar — the agent-device session is likely" >&2
  echo "       wedged on AgentDeviceRunner, or the app never rendered. Aborting." >&2
  exit 1
}

# require_screen <fixed-string-marker> <desc> [attempts] — wait until the marker text
# appears in the a11y tree; hard-fail otherwise so we never ship a wrong screenshot.
require_screen() {
  local marker="$1" desc="$2" tries="${3:-10}"
  for _ in $(seq 1 "$tries"); do
    ad snapshot 2>/dev/null | grep -qF "$marker" && return 0
    sleep 2
  done
  echo "error: expected the $desc screen (marker '$marker') but it never appeared — aborting." >&2
  exit 1
}

# Full-tree ref by fixed string (posts, links, toggles — not tab-bar buttons).
node_ref() { ad snapshot 2>/dev/null | grep -F "$1" | grep -oE '@e[0-9]+' | head -1 || true; }

# Accept the Terms-of-Use gate if it's up (the reviewer seed arms it so App Review
# sees it on first sign-in; a terms re-arm fronts every account's next session).
accept_terms_if_up() {
  ad snapshot 2>/dev/null | grep -qF 'Terms of Use.' || return 0
  echo "    Terms of Use gate is up — accepting"
  local agree; agree="$(node_ref 'I agree')"
  [[ -n "$agree" ]] && ad press "$agree" >/dev/null 2>&1 || true
  settle
}

# Dismiss the once-only first-run onboarding hub if it's up (fresh installs show it
# right after sign-in; it self-marks seen, so this fires at most once per install).
dismiss_onboarding_if_up() {
  ad snapshot 2>/dev/null | grep -qF "How Lesswhelmed works." || return 0
  echo "    first-run onboarding is up — dismissing"
  ad scroll down 2500 >/dev/null 2>&1 || true
  sleep 1
  local got; got="$(node_ref 'Got it')"
  [[ -n "$got" ]] && ad press "$got" >/dev/null 2>&1 || ad back >/dev/null 2>&1 || true
  settle
}

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
  APP="$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/{Sirius,Lesswhelmed}-*/Build/Products/Debug-iphonesimulator/{Sirius,Lesswhelmed}.app 2>/dev/null | head -1 || true)"
  [[ -n "$APP" ]] || { echo "error: no Sirius.app/Lesswhelmed.app in DerivedData. Build it: bun --cwd apps/mobile ios" >&2; exit 1; }
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

# Deterministic capture conditions: pin the appearance (the shipped set is light;
# APPEARANCE=dark to override) and hide the expo-dev-menu floating gear, which is
# dev-build chrome that otherwise photobombs every frame (takes effect on relaunch).
echo "==> Pinning ${APPEARANCE:-light} appearance + hiding the dev-menu gear"
xcrun simctl ui "$UDID" appearance "${APPEARANCE:-light}" 2>/dev/null || true
xcrun simctl spawn "$UDID" defaults write "$APP_ID" EXDevMenuShowFloatingActionButton -bool NO 2>/dev/null || true

# --- Seed the demo library (16 posts) + generate editorial covers --------------
if [[ "$SEED" == 1 ]]; then
  [[ -n "$REVIEWER_PASSWORD" ]] || { echo "error: REVIEWER_PASSWORD/DEV_REVIEWER_PASSWORD unset; set it or pass --skip-seed." >&2; exit 1; }
  if [[ "$TEARDOWN_FIRST" == 1 ]]; then
    echo "==> Tearing down prior demo content (keeps the reviewer user)"
    bun run reviewer:seed --teardown --email "$REVIEWER_EMAIL" || true
  fi
  echo "==> Seeding reviewer library ($REVIEWER_EMAIL) — all demo posts + scene"
  # NODE_EXTRA_CA_CERTS: the friends step signs in at https://sirius.local from the
  # host, which fails "self signed certificate" without trusting the portless CA.
  NODE_EXTRA_CA_CERTS="$CA_PEM" bun run reviewer:seed --email "$REVIEWER_EMAIL" --password "$REVIEWER_PASSWORD"
fi

if [[ "$COVERS" == 1 ]]; then
  echo "==> Generating editorial cover images for every reviewer post"
  # NOTE: --cwd must come AFTER `run` — `bun --cwd <dir> run <script> --flag`
  # swallows the trailing flag and prints `bun run` usage (exit 0) on bun 1.3.x.
  bun run --cwd "$ROOT/apps/worker" backfill:covers --user="$REVIEWER_EMAIL"
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

# Launch + connect, CLASSIFYING what the session actually sees each poll instead of
# counting nodes (the old ">8 nodes = rendered" check false-passed on the dev-client
# launcher, which has ~48 nodes, and fell through silently when the session wedged
# on AgentDeviceRunner — the 2026-07-10 all-identical-screenshots regression).
connect_and_render() {
  xcrun simctl terminate "$UDID" "$APP_ID" >/dev/null 2>&1 || true
  sleep 1
  ad open "$APP_ID" --device "$DEVICE" >/dev/null 2>&1 || true
  sleep 4
  local tree row
  for _ in $(seq 1 25); do
    tree="$(ad snapshot 2>/dev/null || true)"
    if grep -qF 'AgentDeviceRunner' <<<"$tree"; then
      # Session re-attached to the XCUITest runner splash — rebind to the app.
      ad open "$APP_ID" --device "$DEVICE" >/dev/null 2>&1 || true
      sleep 5
    elif grep -qF 'DEVELOPMENT SERVERS' <<<"$tree"; then
      # Expo dev-client launcher — press the first dev-server row by ref (the old
      # blind coordinate tap stays as fallback), then give Metro time to bundle
      # WITHOUT snapshot polling (a snapshot mid-load can re-foreground the runner).
      row="$(grep -E '\[button\] "[^"]+, http' <<<"$tree" | grep -oE '@e[0-9]+' | head -1 || true)"
      if [[ -n "$row" ]]; then
        ad press "$row" >/dev/null 2>&1 || true
      else
        ad press "$DEV_ROW_X" "$DEV_ROW_Y" >/dev/null 2>&1 || true
      fi
      sleep 8
    elif grep -qE '"Sign in\.?"|"How Lesswhelmed works\."|"Terms of Use\."' <<<"$tree" || [[ -n "$(tab_ref Capture)" ]]; then
      return 0 # RN app rendered: sign-in, terms gate, first-run onboarding, or the tab shell
    fi
    sleep 3
  done
  # Last resort: SpringBoard deep link to Metro (prompts "Open in Sirius?").
  xcrun simctl openurl "$UDID" "exp+sirius://expo-development-client/?url=http://$LAN_IP:8081" >/dev/null 2>&1 || true
  ad alert accept >/dev/null 2>&1 || true
  sleep 8
  [[ -n "$(tab_ref Capture)" ]] && return 0
  echo "error: the app never rendered (session sees neither the tab shell nor the" >&2
  echo "       sign-in screen). Check Metro (:8081), the dev client build, and" >&2
  echo "       agent-device; then re-run." >&2
  exit 1
}

echo "==> Launching app + connecting to Metro ($LAN_IP:8081)"
connect_and_render
accept_terms_if_up

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
  # First sign-in can front the terms gate and/or the once-only onboarding hub.
  accept_terms_if_up
  dismiss_onboarding_if_up
fi

# --- Verify the signed-in account is the reviewer -------------------------------
# The 2026-07-10 regression shipped the OWNER's personal library because the sim
# app was already signed in as another account and this script only signs in when
# the sign-in screen is up. The Account tab exposes the signed-in email as a text
# node — require it to match before capturing anything.
echo "==> Verifying signed-in account is $REVIEWER_EMAIL"
press_tab "Account"
require_screen "SECTION IV — ACCOUNT" "Account"
if ! ad snapshot 2>/dev/null | grep -qF "$REVIEWER_EMAIL"; then
  cat >&2 <<EOF
error: the app is signed in as the WRONG account (expected $REVIEWER_EMAIL).
Recover, then re-run this script:
  - Reset the app on this sim (wipes only this sim's login + offline mirror;
    the script reinstalls the dev client and signs in as the reviewer):
      xcrun simctl uninstall "$UDID" "$APP_ID"
  - or sign out manually in the app (Account tab).
EOF
  exit 1
fi

# After sign-in, do ONE more clean reload so the status bar has no return chip and
# the offline mirror has synced all posts before we navigate + capture.
echo "==> Clean reload (clears return chip, syncs library)"
connect_and_render
ad wait 'label="Catalog"' 20000 >/dev/null 2>&1 || true

# --- Capture the canonical screens --------------------------------------------
# After the clean reload, navigating with `ad press` does NOT re-introduce the
# return chip, so every shot stays clean. Every screen is ASSERTED via a marker
# in the a11y tree before shooting — a failed navigation aborts the run instead
# of silently screenshotting whatever is on the glass.
echo "==> Capturing screens"

echo "-> 02 Capture"
press_tab "Capture"
require_screen 'Capture.' "Capture tab"
shot "02-capture.png"

echo "-> 01 Onboarding (How Lesswhelmed works)"
HOW_REF="$(node_ref 'How it works')"
[[ -n "$HOW_REF" ]] || { echo "error: 'How it works' link not found on the Capture tab." >&2; exit 1; }
ad press "$HOW_REF" >/dev/null 2>&1 || true
require_screen 'How Lesswhelmed works.' "onboarding hub"
shot "01-onboarding.png"
# Dismiss the pushed help screen so the tab bar is back for the rest.
ad scroll down 2500 >/dev/null 2>&1 || true
GOT_REF="$(node_ref 'Got it')"
[[ -n "$GOT_REF" ]] && ad press "$GOT_REF" >/dev/null 2>&1 || ad back >/dev/null 2>&1 || true
settle

echo "-> 03 Catalog"
press_tab "Catalog"
require_screen 'SECTION II — CATALOGUE' "Catalog tab"
shot "03-catalog.png"

echo "-> 05 Post detail (Ridge Trail — SIGHT w/ hero image)"
POST_REF="$(node_ref 'Ridge Trail')"
[[ -z "$POST_REF" ]] && POST_REF="$(node_ref 'Sourdough')"
[[ -n "$POST_REF" ]] || { echo "error: no seeded post (Ridge Trail/Sourdough) in the Catalog — did the seed run against this account?" >&2; exit 1; }
ad press "$POST_REF" >/dev/null 2>&1 || true
require_screen 'Ridge Trail' "post detail"
shot "05-post-detail.png"
ad back >/dev/null 2>&1 || true
settle

# The Queue tab was retired (its "In flight" board folded into Catalog) — slot 04
# is now the Friends feed (marketing slide VI updated to match).
echo "-> 04 Friends feed"
press_tab "Friends"
require_screen 'SHARED' "Friends feed"
shot "04-friends.png"

echo "-> 06 Explore / Categories"
press_tab "Explore"
require_screen 'THE OBSERVATORY' "Explore tab"
CAT_REF="$(node_ref 'Categories')"
[[ -n "$CAT_REF" ]] || { echo "error: 'Categories' toggle not found on Explore." >&2; exit 1; }
ad press "$CAT_REF" >/dev/null 2>&1 || true
settle
shot "06-explore-categories.png"

echo "-> 07 Explore / Map (from MAP_IMAGE)"
slot_map

# --- Integrity: no two frames may be identical ----------------------------------
# The 2026-07-10 regression shipped four byte-identical screenshots because every
# navigation silently no-oped. Catch that class of failure before syncing anywhere.
echo "==> Verifying the set has no duplicate frames"
rm -f "$OUT_DIR/04-queue.png" # retired Queue slot (tab removed) — don't let a stale file linger
DUPES="$(md5 -q "$OUT_DIR"/0*.png 2>/dev/null | sort | uniq -d)"
if [[ -n "$DUPES" ]]; then
  echo "error: two or more screenshots in $OUT_DIR are byte-identical — navigation" >&2
  echo "       failed somewhere. Not syncing to the marketing dir." >&2
  exit 1
fi

# --- Sync into the marketing public dir ---------------------------------------
# The marketing site (apps/web/app/(marketing)/constants.ts) references its own
# fixed filenames, which differ from the App Store set. Map App-Store → marketing
# names so re-running refreshes the marketing hero shots without orphan files.
# (Onboarding has no marketing slot today, so it is intentionally not mirrored.)
echo "==> Syncing into apps/web/public/product/screens/ (marketing names)"
declare -a WEB_MAP=(
  "02-capture:01-capture"
  "03-catalog:02-catalog"
  "04-friends:03-friends"
  "06-explore-categories:04-tree"
  "05-post-detail:05-post-detail"
  "07-explore-map:06-explore"
)
for pair in "${WEB_MAP[@]}"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  [[ -f "$OUT_DIR/$src.png" ]] && cp "$OUT_DIR/$src.png" "$WEB_DIR/$dst.png" || true
done
rm -f "$WEB_DIR/03-queue.png" # retired Queue slot's marketing copy

ad close >/dev/null 2>&1 || true

# Capturing consumed the reviewer's one-time Terms acceptance gate (the script
# signed in and accepted it) — re-arm it so App Review still sees the gate.
if [[ "$SEED" == 1 ]]; then
  echo "==> Re-arming the reviewer's Terms gate (captures consumed it)"
  bun run reviewer:seed --email "$REVIEWER_EMAIL" --arm-terms-only
fi

echo
if [[ "$FAIL" == 0 ]]; then
  echo "✓ Done. App Store 6.5\" set (1284x2778) in $OUT_DIR (mirrored to $WEB_DIR)."
else
  echo "✗ One or more screenshots failed their size check — re-run after fixing." >&2
  exit 1
fi
