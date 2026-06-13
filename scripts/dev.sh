#!/usr/bin/env bash
#
# bun run dev — bring up the whole local stack in one shot.
#
# turbo's `dev` runs every app's dev task in PARALLEL with no ordering, and it
# can't boot the iOS Simulator or trust a CA before the apps start. The mobile
# app's HTTPS calls to https://sirius.local fail until the portless CA is trusted
# INSIDE the booted simulator, and the proxy must already own :443 before turbo
# launches. So this wrapper does the ordered prep turbo can't, then hands off:
#
#   1. boot the iOS Simulator (a target for the CA trust + the app launch)
#   2. ensure the portless proxy is up in LAN mode (only if nothing holds :443)
#   3. trust the portless CA inside the booted simulator
#   4. exec `turbo run dev` — web + worker + mobile (mobile = `expo run:ios`,
#      which compiles the dev client, installs it, opens the app, runs Metro)
#
# The heavy path — forcing a proxy mode-switch, re-trusting in the macOS store,
# the one-time iPhone CA-trust runbook — still lives in `bun run dev:proxy`
# (scripts/setup-dev-proxy.sh). This script is the lightweight everyday path and
# deliberately does NOT stop/restart a proxy that's already running.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CA_PEM="${PORTLESS_STATE_DIR:-$HOME/.portless}/ca.pem"

booted() { xcrun simctl list devices booted 2>/dev/null | grep -q "(Booted)"; }

# --- 1. iOS Simulator: boot one so the CA trust + app launch have a target ---
if ! booted; then
  echo "==> Booting the iOS Simulator…"
  open -a Simulator
  for _ in $(seq 1 60); do
    booted && break
    sleep 1
  done
fi
if ! booted; then
  echo "error: no iOS Simulator booted after 60s." >&2
  echo "       Open Simulator.app manually (or run \`bun --cwd apps/mobile ios\`) and retry." >&2
  exit 1
fi

# --- 2. portless proxy: start in LAN mode only if nothing already holds :443 ---
# LAN mode (.local over mDNS) is persisted by portless across restarts, so a plain
# start here keeps it. Skipping when :443 is already bound avoids a needless sudo
# prompt and never silently tears down a running proxy.
if ! lsof -nP -iTCP:443 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "==> Starting portless proxy (LAN mode; may prompt for sudo to bind :443)…"
  portless proxy start --lan
  portless trust >/dev/null 2>&1 || true
fi

# --- 3. Trust the portless CA inside the booted simulator (idempotent) ---
if [ -f "$CA_PEM" ]; then
  echo "==> Trusting portless CA in the booted simulator…"
  xcrun simctl keychain booted add-root-cert "$CA_PEM" >/dev/null 2>&1 \
    || echo "    warn: could not add CA to the simulator (continuing)." >&2
else
  echo "    warn: portless CA not found at $CA_PEM — run \`bun run dev:proxy\` once." >&2
fi

# --- 4. Start the stack (web at https://sirius.local; mobile opens in the sim) ---
echo "==> Starting web + worker + mobile…"
exec turbo run dev
