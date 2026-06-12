#!/usr/bin/env bash
#
# One-time (per boot) local dev proxy setup for portless.
#
# Puts the web dev server behind stable HTTPS URLs — https://sirius.localhost
# (this Mac + simulator) and https://sirius.local (any device on the same
# Wi-Fi, via mDNS LAN mode) — so the mobile app's EXPO_PUBLIC_AUTH_BASE_URL
# never goes stale and a physical iPhone can reach the dev stack. Run this
# BEFORE `bun run dev`: turbo runs the dev task non-interactively and portless
# can't sudo-elevate to bind :443 from inside the turbo TUI, so the proxy
# daemon must already be up.
#
# The proxy is a persistent background daemon — you only need this after a reboot
# (or after `portless proxy stop`); portless persists LAN mode across restarts.
# To start it automatically at login instead:
#   portless service install
#
# Usage: bun run dev:proxy   (or: bash scripts/setup-dev-proxy.sh)
set -euo pipefail

CA_PEM="${PORTLESS_STATE_DIR:-$HOME/.portless}/ca.pem"

if ! command -v portless >/dev/null 2>&1; then
  echo "error: portless not found on PATH." >&2
  echo "  Install globally:  npm install -g portless   (or: bun add -g portless)" >&2
  exit 1
fi

# LAN mode (.local names over mDNS) lets physical devices on the same Wi-Fi
# reach the dev server. A proxy already running WITHOUT LAN mode must be
# stopped first — portless refuses to silently change modes on a live daemon.
echo "==> Starting portless proxy in LAN mode (HTTPS :443; may prompt for sudo)…"
# A proxy bound to :443 was started via sudo — stopping it needs sudo too.
portless proxy stop >/dev/null 2>&1 || sudo portless proxy stop >/dev/null 2>&1 || true
portless proxy start --lan

echo "==> Ensuring the portless CA is trusted in the macOS system store…"
portless trust || true

# The iOS Simulator does NOT inherit the macOS system trust store on modern iOS
# versions, so HTTPS calls to https://sirius.localhost fail with a cert error
# until the portless root CA is added to the *booted* simulator's keychain.
if command -v xcrun >/dev/null 2>&1; then
  if xcrun simctl list devices booted 2>/dev/null | grep -q "(Booted)"; then
    echo "==> Trusting the portless CA in the booted iOS Simulator…"
    xcrun simctl keychain booted add-root-cert "$CA_PEM" \
      && echo "    done." \
      || echo "    warn: could not add the CA to the simulator (continuing)." >&2
  else
    echo "==> No booted iOS Simulator detected."
    echo "    Boot the simulator (bun --cwd apps/mobile ios), then re-run this script,"
    echo "    or run manually:"
    echo "      xcrun simctl keychain booted add-root-cert $CA_PEM"
  fi
else
  echo "==> xcrun not found — skipping simulator CA trust (not on macOS / no Xcode)."
fi

echo
echo "==> iPhone / physical device setup (one-time per device):"
echo "    1. AirDrop (or email) the portless root CA to the device:"
echo "         $CA_PEM"
open -R "$CA_PEM" 2>/dev/null || true
echo "    2. On the iPhone: Settings → 'Profile Downloaded' → Install."
echo "    3. Then Settings → General → About → Certificate Trust Settings →"
echo "       enable FULL TRUST for the portless root CA."
echo "    4. The dev stack is then at https://sirius.local from the device"
echo "       (same Wi-Fi as this Mac; mDNS/Bonjour must not be blocked)."
echo
echo "==> Dev proxy ready:"
portless get sirius 2>/dev/null || echo "    https://sirius.localhost (registers once you run \`bun run dev\`)"
echo "    LAN: https://sirius.local (devices on this Wi-Fi)"
echo
echo "Next: start the apps with \`bun run dev\` (web at https://sirius.localhost and https://sirius.local)."
