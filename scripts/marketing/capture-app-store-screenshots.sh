#!/usr/bin/env bash
# Reproducibly capture the App Store screenshot set for Sirius (iOS).
#
# This is the single source of truth for regenerating the 6.9" screenshots in
# app-store-assets/screenshots/iphone-6.9/ (and the copies the marketing page
# serves from apps/web/public/product/screens/). It drives the *installed* dev
# client on the "Sirius 6.9 ProMax" simulator with agent-device, seeds a clean
# safe-for-work demo library first (the same reviewer:seed used for App Review),
# navigates the six canonical screens, and captures each at the native 6.9"
# resolution (1320 x 2868) — then asserts every PNG is exactly that size.
#
# PREREQUISITES (this script does NOT start them):
#   1. The dev stack is running so https://sirius.local APIs answer:
#        bun run dev:stack      # web + worker + mobile (or the full `bun run dev`)
#      The mobile dev client must already be built+installed on the 6.9" sim.
#   2. A local DATABASE_URL (root .env) for the seed, and GEMINI_API_KEY if you
#      want the Explore taxonomy/Map populated (the seed's --scene stage embeds
#      content; without a key, pass --no-scene-seed and Map/Categories are thin).
#
# USAGE:
#   REVIEWER_PASSWORD='StrongPass123' bun run app-store:screenshots
#   REVIEWER_PASSWORD='…' scripts/marketing/capture-app-store-screenshots.sh --teardown-first
#   scripts/marketing/capture-app-store-screenshots.sh --skip-seed         # reuse existing data/session
#   scripts/marketing/capture-app-store-screenshots.sh --skip-65           # skip the 6.5" set (on by default)
#   scripts/marketing/capture-app-store-screenshots.sh --with-video        # also rebuild the demo video
#
# ENV (all optional except the password when seeding):
#   DEVICE            simulator name        (default "Sirius 6.9 ProMax")
#   APP_ID            dev client bundle id  (default dev.copt.sirius)
#   SESSION           agent-device session  (default app-store)
#   REVIEWER_EMAIL    sign-in email         (default reviewer@lesswhelmed.com)
#   REVIEWER_PASSWORD sign-in password      (required unless --skip-seed AND already signed in)
#   SETTLE_MS         per-screen settle ms  (default 1400)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DEVICE="${DEVICE:-Sirius 6.9 ProMax}"
APP_ID="${APP_ID:-dev.copt.sirius}"
SESSION="${SESSION:-app-store}"
REVIEWER_EMAIL="${REVIEWER_EMAIL:-reviewer@lesswhelmed.com}"
SETTLE_MS="${SETTLE_MS:-1400}"
OUT_DIR="$ROOT/app-store-assets/screenshots/iphone-6.9"
WEB_DIR="$ROOT/apps/web/public/product/screens"

SEED=1
TEARDOWN_FIRST=0
SCENE_SEED=1
WITH_65=1
WITH_VIDEO=0
STATUS_BAR=1

for arg in "$@"; do
  case "$arg" in
    --skip-seed) SEED=0 ;;
    --teardown-first) TEARDOWN_FIRST=1 ;;
    --no-scene-seed) SCENE_SEED=0 ;;
    --skip-65) WITH_65=0 ;;
    --with-65) WITH_65=1 ;; # back-compat no-op: the 6.5" set is now on by default
    --with-video) WITH_VIDEO=1 ;;
    --no-status-bar) STATUS_BAR=0 ;;
    -h | --help)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *)
      echo "unknown option: $arg (see --help)" >&2
      exit 2
      ;;
  esac
done

ad() { agent-device "$@" --session "$SESSION" --platform ios; }

# First @eN ref whose snapshot line matches the given extended-regex. Never
# fails the script under `set -e` (empty string when nothing matches).
ref() { ad snapshot -i 2>/dev/null | grep -E "$1" 2>/dev/null | grep -oE '@e[0-9]+' | head -1 || true; }

settle() { sleep "$(awk "BEGIN{print $SETTLE_MS/1000}")"; }

FAIL=0
# verify_dims <file> [expected_w] [expected_h] — defaults to the native 6.9" size.
verify_dims() {
  local f="$1" ew="${2:-1320}" eh="${3:-2868}" w h
  w="$(sips -g pixelWidth "$f" 2>/dev/null | awk '/pixelWidth/{print $2}')"
  h="$(sips -g pixelHeight "$f" 2>/dev/null | awk '/pixelHeight/{print $2}')"
  if [[ "$w" == "$ew" && "$h" == "$eh" ]]; then
    echo "  ✓ $(basename "$f") ${w}x${h}"
  else
    echo "  ✗ $(basename "$f") is ${w:-?}x${h:-?}, expected ${ew}x${eh}" >&2
    FAIL=1
  fi
}

shot() {
  local name="$1"
  settle
  xcrun simctl io booted screenshot "$OUT_DIR/$name" >/dev/null
  verify_dims "$OUT_DIR/$name"
}

# --- Preflight ----------------------------------------------------------------
command -v agent-device >/dev/null || {
  echo "error: agent-device not on PATH (need >= 0.14)." >&2
  exit 1
}
command -v sips >/dev/null || {
  echo "error: sips not found (macOS only)." >&2
  exit 1
}
mkdir -p "$OUT_DIR" "$WEB_DIR"

# --- Boot the 6.9" simulator + clean status bar -------------------------------
echo "==> Booting '$DEVICE'"
if ! xcrun simctl list devices booted 2>/dev/null | grep -q "$DEVICE"; then
  xcrun simctl boot "$DEVICE" 2>/dev/null || true
fi
open -a Simulator
for _ in $(seq 1 60); do
  xcrun simctl list devices booted 2>/dev/null | grep -q "$DEVICE" && break
  sleep 1
done
xcrun simctl list devices booted 2>/dev/null | grep -q "$DEVICE" || {
  echo "error: '$DEVICE' did not boot. Check \`xcrun simctl list devices available\`." >&2
  exit 1
}

if [[ "$STATUS_BAR" == 1 ]]; then
  echo "==> Applying clean status bar (9:41, full signal, 100%)"
  xcrun simctl status_bar "$DEVICE" override \
    --time "9:41" \
    --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 \
    --batteryState charged --batteryLevel 100 || true
fi

# --- Seed the demo library ----------------------------------------------------
if [[ "$SEED" == 1 ]]; then
  if [[ -z "${REVIEWER_PASSWORD:-}" ]]; then
    echo "error: REVIEWER_PASSWORD is required to seed. Set it, or pass --skip-seed." >&2
    exit 1
  fi
  scene_flag=()
  [[ "$SCENE_SEED" == 0 ]] && scene_flag=(--no-scene)
  if [[ "$TEARDOWN_FIRST" == 1 ]]; then
    echo "==> Tearing down any prior demo content"
    bun run reviewer:seed --teardown --email "$REVIEWER_EMAIL" || true
  fi
  echo "==> Seeding reviewer library (email $REVIEWER_EMAIL)"
  bun run reviewer:seed \
    --email "$REVIEWER_EMAIL" \
    --password "$REVIEWER_PASSWORD" \
    "${scene_flag[@]}"
else
  echo "==> Skipping seed (--skip-seed)"
fi

# --- Launch the app + sign in if needed ---------------------------------------
# Two things matter for clean shots:
#   1. `agent-device open <bundle>` only foregrounds the Expo dev-client launcher
#      and, worse, leaves a "<- AgentDeviceRunner" return chip in the status bar
#      (an app->app handoff artifact). We bind the agent-device session ONCE with
#      `open`, then do a clean SpringBoard relaunch via `simctl openurl` of the
#      dev-client deep link — that loads the JS bundle from Metro AND clears the
#      return chip (SpringBoard-initiated launches have no "return to app"). The
#      simulator shares the host loopback, so localhost:8081 reaches Metro.
#   2. A dev build pops a RevenueCat "Error fetching offerings" LogBox toast on
#      launch; it auto-dismisses after a few seconds, so we settle before shooting.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
METRO_HOST="${METRO_HOST:-localhost}"
DEEP_LINK="exp+sirius://expo-development-client/?url=http://$METRO_HOST:8081"

echo "==> Binding agent-device session"
agent-device open "$APP_ID" --session "$SESSION" --platform ios --device "$DEVICE" >/dev/null 2>&1 || true
echo "==> Clean relaunch via SpringBoard ($DEEP_LINK)"
xcrun simctl terminate "$DEVICE" "$APP_ID" >/dev/null 2>&1 || true
sleep 2
xcrun simctl openurl "$DEVICE" "$DEEP_LINK" >/dev/null 2>&1 || true
# Wait for the JS bundle + the app shell (sign-in screen or the tab bar) to mount,
# and for the launch-time RevenueCat LogBox toast to auto-dismiss.
ad wait 'label="Sign in"' 25000 >/dev/null 2>&1 ||
  ad wait 'label="Capture"' 25000 >/dev/null 2>&1 || true
sleep 6

if ad is visible 'label="Sign in"' >/dev/null 2>&1; then
  if [[ -z "${REVIEWER_PASSWORD:-}" ]]; then
    echo "error: sign-in screen is up but REVIEWER_PASSWORD is unset." >&2
    exit 1
  fi
  echo "==> Signing in as $REVIEWER_EMAIL"
  # The sign-in inputs are a [text-field] / [securetextfield] both exposed with
  # accessibility label "Email" / "Password" (see sign-in.tsx <AuthField/>).
  ad fill 'label="Email"' "$REVIEWER_EMAIL" --delay-ms 40 >/dev/null 2>&1 || true
  ad fill 'label="Password"' "$REVIEWER_PASSWORD" --delay-ms 40 >/dev/null 2>&1 || true
  ad keyboard dismiss >/dev/null 2>&1 || true
  ad press 'label="Sign in"' >/dev/null 2>&1 || true
  ad wait 'label="Capture"' 20000 >/dev/null 2>&1 ||
    ad wait 'label="Catalog"' 20000 >/dev/null 2>&1 || true
fi

# --- Capture the six canonical screens ----------------------------------------
echo "==> Capturing screens"

echo "-> 01 Capture"
ad press 'label="Capture"' >/dev/null 2>&1 || true
shot "01-capture.png"

echo "-> 02 Catalog"
ad press 'label="Catalog"' >/dev/null 2>&1 || true
shot "02-catalog.png"

echo "-> 03 Queue"
ad press 'label="Queue"' >/dev/null 2>&1 || true
shot "03-queue.png"

echo "-> 04 Explore / Categories"
ad press 'label="Explore"' >/dev/null 2>&1 || true
settle
CAT_REF="$(ref '\[tab\].*Categories|Categories')"
[[ -n "$CAT_REF" ]] && ad press "$CAT_REF" >/dev/null 2>&1 || true
shot "04-tree.png"

echo "-> 06 Explore / Map"
MAP_REF="$(ref '\[tab\].*"Map"|"Map"')"
[[ -n "$MAP_REF" ]] && ad press "$MAP_REF" >/dev/null 2>&1 || true
shot "06-explore.png"

echo "-> 05 Post detail (Ridge Trail — SIGHT w/ hero image)"
ad press 'label="Catalog"' >/dev/null 2>&1 || true
settle
POST_REF="$(ref 'Ridge Trail')"
[[ -z "$POST_REF" ]] && POST_REF="$(ref 'Sourdough')"
if [[ -n "$POST_REF" ]]; then
  ad press "$POST_REF" >/dev/null 2>&1 || true
else
  # Fallback: deep-link straight to the seeded SIGHT post with a hero image.
  xcrun simctl openurl "$DEVICE" "siriusapp://post/ridge-trail-day-hike" >/dev/null 2>&1 || true
fi
shot "05-post-detail.png"

# --- Sync into the marketing public dir ---------------------------------------
echo "==> Syncing into apps/web/public/product/screens/"
for f in 01-capture 02-catalog 03-queue 04-tree 05-post-detail 06-explore; do
  cp "$OUT_DIR/$f.png" "$WEB_DIR/$f.png"
done

# --- Downscaled 6.5" set (Apple requires a 6.5" set; 1284 x 2778) -------------
# On by default — App Store Connect needs both the 6.9" and 6.5" portrait sets.
# 1284 x 2778 is one of Apple's accepted 6.5" sizes (others: 1242 x 2688). We
# `sips -z` to lock exact pixel dims (Apple validates on exact size); the tiny
# aspect delta from the 6.9" source is imperceptible.
if [[ "$WITH_65" == 1 ]]; then
  echo "==> Regenerating the 6.5\" set (1284 x 2778)"
  SIX5="$ROOT/app-store-assets/screenshots/iphone-6.5"
  mkdir -p "$SIX5"
  # Only the six canonical screens — never glob the source dir (strays leak in).
  for f in 01-capture 02-catalog 03-queue 04-tree 05-post-detail 06-explore; do
    cp "$OUT_DIR/$f.png" "$SIX5/$f.png"
    sips -z 2778 1284 "$SIX5/$f.png" >/dev/null
    verify_dims "$SIX5/$f.png" 1284 2778
  done
fi

# --- Optional: rebuild the marketing demo video -------------------------------
if [[ "$WITH_VIDEO" == 1 ]]; then
  echo "==> Rebuilding demo video (captions + ffmpeg)"
  bash "$ROOT/scripts/marketing/render-captions.sh"
  bash "$ROOT/scripts/marketing/build-demo-video.sh"
fi

agent-device close --session "$SESSION" --platform ios >/dev/null 2>&1 || true

echo
if [[ "$FAIL" == 0 ]]; then
  echo "✓ Done. Six 6.9\" screenshots in $OUT_DIR (mirrored to $WEB_DIR)."
  [[ "$WITH_65" == 1 ]] &&
    echo "  Plus the 6.5\" set (1284x2778) in $ROOT/app-store-assets/screenshots/iphone-6.5."
else
  echo "✗ One or more screenshots failed their size check — re-run after fixing." >&2
  exit 1
fi
