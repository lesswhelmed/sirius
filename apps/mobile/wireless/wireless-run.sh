#!/usr/bin/env bash
# Build + install + launch the Sirius mobile dev client on a phone over Wi-Fi
# (adb wireless debugging) and start Metro — one command for a dev/test cycle.
#
# Usage:
#   ./wireless-run.sh                       # reuse last endpoint (or mDNS auto-discover)
#   ./wireless-run.sh 192.168.50.89:43027   # connect to a specific IP:PORT and remember it
#
# Pairing is one-time (do it once with: adb pair <ip>:<pairPort> <code>).
# The CONNECT ip:port can change after a reboot / toggling Wireless debugging —
# when that happens, grab the new one from Settings > Developer options >
# Wireless debugging and pass it as the argument above.
#
# Env knobs:
#   NO_BUILD=1            skip the gradle rebuild — just relaunch the installed app
#   DEV_SERVER_PORT=3000  host port the web app (`bun run notmobile:dev`) listens on
#   EXPO_PUBLIC_AUTH_BASE_URL   override what the app talks to (default http://localhost:3000,
#                               reached on the phone via `adb reverse` set up below)
#
# Unlike a portless/sirius.local setup, this path needs no LAN cert trust: `adb reverse`
# tunnels the phone's localhost:3000 → this host over the same wireless adb link, so the
# dev client just talks to http://localhost:3000 (already an auth-trusted origin).

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$HERE/.." && pwd)"

export ANDROID_HOME="${ANDROID_HOME:-/home/pi/Android/Sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
STATE_FILE="$HERE/.last-wireless-endpoint"
PKG="dev.copt.sirius"
DEV_SERVER_PORT="${DEV_SERVER_PORT:-3000}"
export EXPO_PUBLIC_AUTH_BASE_URL="${EXPO_PUBLIC_AUTH_BASE_URL:-http://localhost:${DEV_SERVER_PORT}}"

# 1. Figure out the endpoint: explicit arg wins; else auto-discover via find-phone.sh.
ENDPOINT="${1:-}"
if [ -z "$ENDPOINT" ]; then
    ENDPOINT="$("$HERE/find-phone.sh" || true)"
fi
if [ -z "$ENDPOINT" ]; then
    echo "No endpoint found. Turn ON Settings > Developer options > Wireless debugging"
    echo "on the phone (then it's auto-discovered), or pass it: ./wireless-run.sh <ip>:<port>"
    exit 1
fi

# 2. Connect (idempotent — already-connected is fine).
"$ADB" connect "$ENDPOINT" >/dev/null
if ! "$ADB" devices | grep -q "^$ENDPOINT[[:space:]]*device$"; then
    echo "Could not reach $ENDPOINT. If the phone rebooted, the port changed —"
    echo "grab the new ip:port from the Wireless debugging screen and pass it as an arg."
    exit 1
fi
echo "$ENDPOINT" > "$STATE_FILE"
echo "Connected: $ENDPOINT"

# 3. Pick a Metro port. Default 8081, but auto-bump if something else (e.g. another
#    project's Metro) already holds it — then the dev client + reverse + expo all use the
#    SAME port, instead of expo silently choosing 8082 while we reversed 8081.
port_busy() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }
METRO_PORT="${METRO_PORT:-}"
if [ -z "$METRO_PORT" ]; then
    for p in 8081 8082 8083 8084 8085; do
        port_busy "$p" || { METRO_PORT="$p"; break; }
    done
    METRO_PORT="${METRO_PORT:-8081}"
fi

# Tunnel the host dev stack to the phone over the wireless adb link.
#   $METRO_PORT      = Metro (JS bundle + reload) — the dev client looks here on-device
#   $DEV_SERVER_PORT = the web app/API the app calls
echo "Reversing localhost:$METRO_PORT (Metro) + localhost:$DEV_SERVER_PORT (web) onto the phone…"
"$ADB" -s "$ENDPOINT" reverse "tcp:$METRO_PORT" "tcp:$METRO_PORT" >/dev/null
"$ADB" -s "$ENDPOINT" reverse "tcp:$DEV_SERVER_PORT" "tcp:$DEV_SERVER_PORT" >/dev/null
echo "    app will reach the web stack at $EXPO_PUBLIC_AUTH_BASE_URL"
echo "    (make sure it's running: \`bun run dev:wireless:host\` in another terminal)"

# 4a. NO_BUILD: just relaunch the already-installed dev client and stop.
if [ "${NO_BUILD:-0}" = "1" ]; then
    echo "NO_BUILD=1 → relaunching installed $PKG (no rebuild, no Metro)…"
    "$ADB" -s "$ENDPOINT" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
    echo "Launched. 🐧  (start Metro yourself if needed: bun --cwd apps/mobile start)"
    exit 0
fi

# 4b. Gate on the on-device-AI native bridge (llama.rn must autolink), same as the
#     EAS build scripts — a build missing it ships a binary that throws at runtime.
echo "Verifying on-device-AI native artifacts…"
bun --cwd "$MOBILE_DIR" run verify:native-ai

# 4c. Build the Android dev client, install it on THIS phone, launch it, and start Metro.
#     expo run:android auto-prebuilds android/ if missing and reuses it otherwise.
#
#     `--device` matches by device NAME, not the wireless ip:port serial, so passing the
#     endpoint there fails ("Could not find device with name"). When the wireless phone is
#     the ONLY connected device, omit it — expo auto-selects the single device. With more
#     than one connected, target it via ANDROID_SERIAL (adb honors it) and pass --device
#     best-effort.
echo "Building + installing the dev client on $ENDPOINT (Metro on :$METRO_PORT)…"
DEVICE_COUNT="$("$ADB" devices | grep -cE '[[:space:]]device$' || true)"
if [ "${DEVICE_COUNT:-0}" -gt 1 ]; then
    echo "    multiple devices connected — targeting $ENDPOINT via ANDROID_SERIAL."
    export ANDROID_SERIAL="$ENDPOINT"
    exec bun --cwd "$MOBILE_DIR" expo run:android --device "$ENDPOINT" --port "$METRO_PORT"
fi
exec bun --cwd "$MOBILE_DIR" expo run:android --port "$METRO_PORT"
