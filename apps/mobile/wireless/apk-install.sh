#!/usr/bin/env bash
# Compile a STANDALONE APK (JS bundle embedded — no Metro, no dev client) and install +
# launch it on a phone over Wi-Fi (adb wireless debugging). One command, no Expo dev server.
#
# Default target is PRODUCTION (https://lesswhelmed.com) so the installed app just works:
# no `dev:wireless:host`, no `adb reverse`, no cleartext config. Your local JS/UI changes
# are baked into the bundle at build time; only the API endpoint is the live server.
#
# Usage:
#   ./apk-install.sh                       # discover phone, build, install, launch
#   ./apk-install.sh 192.168.50.89:44545   # use a specific ip:port (and remember it)
#
# Env knobs:
#   EXPO_PUBLIC_AUTH_BASE_URL   backend baked into the bundle (default https://lesswhelmed.com)
#   VARIANT=release|debug       gradle build variant (default release; debug needs Metro)
#   NO_BUILD=1                  skip gradle — just (re)install the last-built APK
#
# Pairing is one-time (adb pair <ip>:<pairPort> <code>). The connect ip:port rotates after
# a phone reboot — grab the new one from Settings > Developer options > Wireless debugging
# and pass it as the argument.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$HERE/.." && pwd)"
ANDROID_DIR="$MOBILE_DIR/android"

export ANDROID_HOME="${ANDROID_HOME:-/home/pi/Android/Sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
ADB="$ANDROID_HOME/platform-tools/adb"
STATE_FILE="$HERE/.last-wireless-endpoint"
PKG="dev.copt.sirius"

export EXPO_PUBLIC_AUTH_BASE_URL="${EXPO_PUBLIC_AUTH_BASE_URL:-https://lesswhelmed.com}"
VARIANT="${VARIANT:-release}"
# Capitalize for the gradle task name (assembleRelease) and the apk output dir.
VARIANT_CAP="$(printf '%s' "${VARIANT:0:1}" | tr '[:lower:]' '[:upper:]')${VARIANT:1}"
APK="$ANDROID_DIR/app/build/outputs/apk/$VARIANT/app-$VARIANT.apk"

# 1. Endpoint: explicit arg wins; else auto-discover via find-phone.sh.
ENDPOINT="${1:-}"
if [ -z "$ENDPOINT" ]; then
    ENDPOINT="$("$HERE/find-phone.sh" || true)"
fi
if [ -z "$ENDPOINT" ]; then
    echo "No phone found. Turn ON Settings > Developer options > Wireless debugging, or pass"
    echo "the ip:port: ./apk-install.sh 192.168.50.89:44545"
    exit 1
fi

# 2. Connect (idempotent) and verify.
"$ADB" connect "$ENDPOINT" >/dev/null
if ! "$ADB" devices | grep -q "^$ENDPOINT[[:space:]]*device$"; then
    echo "Could not reach $ENDPOINT. If the phone rebooted the port changed — grab the new"
    echo "ip:port from the Wireless debugging screen and pass it as an argument."
    exit 1
fi
echo "$ENDPOINT" > "$STATE_FILE"
echo "Connected: $ENDPOINT"

# 3. Build the APK (unless NO_BUILD=1).
if [ "${NO_BUILD:-0}" != "1" ]; then
    # Native project must exist (gitignored — regenerated from app.json). Generate if missing.
    if [ ! -d "$ANDROID_DIR" ]; then
        echo "No android/ project — running expo prebuild (android)…"
        bun --cwd "$MOBILE_DIR" expo prebuild -p android
    fi
    # On-device-AI native gate (llama.rn must autolink), same as the EAS build scripts.
    echo "Verifying on-device-AI native artifacts…"
    bun --cwd "$MOBILE_DIR" run verify:native-ai

    echo "Building $VARIANT APK (backend: $EXPO_PUBLIC_AUTH_BASE_URL)…"
    echo "  (first build compiles the llama.rn native bridge from scratch — several minutes)"
    ( cd "$ANDROID_DIR" && ./gradlew ":app:assemble$VARIANT_CAP" --console=plain )
fi

if [ ! -f "$APK" ]; then
    echo "error: expected APK not found at $APK" >&2
    exit 1
fi
echo "APK: $APK ($(du -h "$APK" | cut -f1))"

# 4. Install on THIS phone. The APK is signed with the debug key; if a differently-signed
#    build (e.g. an old EAS/dev-client install) is present, Android rejects the update —
#    uninstall and retry in that case.
echo "Installing on $ENDPOINT…"
if ! out="$("$ADB" -s "$ENDPOINT" install -r -d "$APK" 2>&1)"; then
    if printf '%s' "$out" | grep -qiE 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match|INSTALL_FAILED_VERSION_DOWNGRADE'; then
        echo "  signature/version conflict with the installed build — uninstalling $PKG and retrying…"
        "$ADB" -s "$ENDPOINT" uninstall "$PKG" >/dev/null 2>&1 || true
        "$ADB" -s "$ENDPOINT" install "$APK"
    else
        printf '%s\n' "$out" >&2
        exit 1
    fi
fi

# 5. Launch.
echo "Launching $PKG…"
"$ADB" -s "$ENDPOINT" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
echo "Done. 🐧  Installed + launched on $ENDPOINT (talking to $EXPO_PUBLIC_AUTH_BASE_URL)."
