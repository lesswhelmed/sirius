#!/usr/bin/env bash
#
# One-time (per boot) local dev proxy setup for portless.
#
# Puts the web dev server behind a stable HTTPS URL — https://sirius.localhost —
# instead of a raw localhost port, so the mobile app's EXPO_PUBLIC_AUTH_BASE_URL
# never goes stale. Run this BEFORE `bun run dev`: turbo runs the dev task
# non-interactively and portless can't sudo-elevate to bind :443 from inside the
# turbo TUI, so the proxy daemon must already be up.
#
# The proxy is a persistent background daemon — you only need this after a reboot
# (or after `portless proxy stop`). To start it automatically at login instead:
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

echo "==> Starting portless proxy (HTTPS :443; may prompt for sudo)…"
portless proxy start

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
echo "==> Dev proxy ready:"
portless get sirius 2>/dev/null || echo "    https://sirius.localhost (registers once you run \`bun run dev\`)"
echo
echo "Next: start the apps with \`bun run dev\` (web is served at https://sirius.localhost)."
