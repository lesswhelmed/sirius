#!/usr/bin/env bash
# install-android-prod.sh — sideload a Sirius PRODUCTION build onto a USB device.
#
# EAS production builds produce an .aab (Play Store bundle) which CANNOT be
# `adb install`-ed directly. This script bridges that gap: it resolves the latest
# FINISHED production AAB (or takes an explicit path/URL), converts it to a
# device-installable *universal* APK with bundletool, then adb-installs it.
#
# The universal APK is debug-signed (bundletool uses ~/.android/debug.keystore) —
# that only affects the sideload wrapper; the app inside is still the production
# build (points at lesswhelmed.com, prod keys, runs standalone, no Metro).
#
# Usage:
#   bash .claude/skills/android-device-deploy/scripts/install-android-prod.sh            # latest finished prod AAB
#   bash .claude/skills/android-device-deploy/scripts/install-android-prod.sh <aab-url>  # a specific artifact URL
#   bash .claude/skills/android-device-deploy/scripts/install-android-prod.sh ./app.aab  # a local .aab
#
# Env:
#   ANDROID_SERIAL   target a specific device (else the single connected one)
#   NO_INSTALL=1     build the universal APK but skip adb install (prints its path)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
APP_ID="dev.copt.sirius"
WORKDIR="${TMPDIR:-/tmp}/sirius-android-install"
mkdir -p "$WORKDIR"

need() { command -v "$1" >/dev/null 2>&1 || { echo "✖ missing '$1' — $2"; exit 1; }; }
need bundletool "install with: brew install bundletool"
need java       "bundletool needs a JRE (brew install openjdk)"
need adb        "install Android platform-tools"
need node       "needed to parse eas build:list JSON"

AAB_SRC="${1:-}"

if [ -z "$AAB_SRC" ]; then
  echo "→ resolving latest FINISHED production Android build from EAS…"
  AAB_SRC="$(cd "$MOBILE_DIR" && bunx eas-cli build:list --platform android --limit 15 --non-interactive --json 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const b=(JSON.parse(d)||[]).find(x=>x.status==="FINISHED"&&x.buildProfile==="production");if(!b){console.error("no finished production build found");process.exit(1)}process.stdout.write(b.artifacts?.applicationArchiveUrl||b.artifacts?.buildUrl||"")})')"
  [ -n "$AAB_SRC" ] || { echo "✖ could not resolve a finished production build URL"; exit 1; }
  echo "  using: $AAB_SRC"
fi

AAB="$WORKDIR/app.aab"
case "$AAB_SRC" in
  http*://*) echo "→ downloading AAB…"; curl -fL -o "$AAB" "$AAB_SRC" ;;
  *)         [ -f "$AAB_SRC" ] || { echo "✖ not a file: $AAB_SRC"; exit 1; }; cp "$AAB_SRC" "$AAB" ;;
esac
echo "  AAB: $(du -h "$AAB" | cut -f1)"

echo "→ bundletool: AAB → universal APK (debug-signed for sideload)…"
bundletool build-apks --bundle="$AAB" --output="$WORKDIR/app.apks" --mode=universal --overwrite >/dev/null
unzip -o "$WORKDIR/app.apks" universal.apk -d "$WORKDIR" >/dev/null
APK="$WORKDIR/universal.apk"
echo "  universal APK: $APK ($(du -h "$APK" | cut -f1))"

if [ "${NO_INSTALL:-}" = "1" ]; then
  echo "✔ built (NO_INSTALL=1). Install manually: adb install -r \"$APK\""
  exit 0
fi

DEV_ARGS=()
[ -n "${ANDROID_SERIAL:-}" ] && DEV_ARGS=(-s "$ANDROID_SERIAL")
if ! adb "${DEV_ARGS[@]}" get-state >/dev/null 2>&1; then
  echo "✖ no device. Plug in over USB (data mode), unlock, tap 'Allow USB debugging', then:"
  echo "    adb devices -l"
  exit 1
fi

echo "→ adb install -r …"
if ! adb "${DEV_ARGS[@]}" install -r "$APK"; then
  cat <<EOF
✖ install failed. If it was a SIGNATURE mismatch (INSTALL_FAILED_UPDATE_INCOMPATIBLE)
  or a version downgrade, the installed app was signed with a different key. To replace it:
      adb ${DEV_ARGS[*]} uninstall $APP_ID    # WARNING: wipes on-device app data + login
  then re-run this script. Confirm with the owner before wiping.
EOF
  exit 1
fi

echo "✔ installed. Launch it with:"
echo "    adb ${DEV_ARGS[*]} shell monkey -p $APP_ID -c android.intent.category.LAUNCHER 1"
