#!/usr/bin/env bash
# Smoke-test the mobile Tree tab's category outline on a running iOS Simulator.
#
# This drives the *installed* app (dev client / preview / production — whatever is
# booted) with agent-device and asserts the Categories outline actually rendered.
# It does NOT rebuild — point it at whichever build you want to test by booting
# that build in the Simulator first.
#
# What it proves: the app reached GET /api/app/embedding-scene with a valid
# session AND the server returned a non-empty CategoryEmbedding taxonomy. If the
# Tree shows "Couldn't load the tree" (401 / wrong server) or "No analysis
# branches yet" (empty taxonomy on that server's DB) this script fails loudly —
# which is exactly the production failure mode (see docs below).
#
# Usage:  apps/mobile/scripts/test-tree-categories.sh
# Env:    APP_ID    (default dev.copt.sirius)
#         DEVICE    (default "iPhone 17 Pro")
#         SESSION   (default tree-test)
set -euo pipefail

APP_ID="${APP_ID:-dev.copt.sirius}"
DEVICE="${DEVICE:-iPhone 17 Pro}"
SESSION="${SESSION:-tree-test}"

ad() { agent-device "$@" --session "$SESSION" --platform ios; }

echo "→ opening $APP_ID on '$DEVICE'"
agent-device open "$APP_ID" --session "$SESSION" --platform ios --device "$DEVICE" >/dev/null

echo "→ navigating to the Tree tab"
sleep 2
# Resolve the Tree tab-bar button's current @eN ref from a fresh snapshot, then
# press it (tab-bar buttons don't expose a stable id selector).
TREE_REF="$(ad snapshot -i 2>/dev/null | grep '\[button\] "Tree"' | grep -oE '@e[0-9]+' | head -1)"
if [[ -z "$TREE_REF" ]]; then
  echo "✗ FAIL: could not find the Tree tab button (app didn't reach the tab bar)."
  exit 1
fi
ad press "$TREE_REF" >/dev/null
sleep 1

# The error state renders this exact title; fail fast if the scene didn't load.
if ad is visible 'label="Couldn’t load the tree"' >/dev/null 2>&1; then
  echo "✗ FAIL: Tree failed to load (401 / wrong server / signed out)."
  echo "        The app is talking to a server where this account has no session"
  echo "        or the embedding-scene endpoint 401'd. Check EXPO_PUBLIC_AUTH_BASE_URL."
  exit 1
fi

# Empty-but-loaded state (server reachable, but no CategoryEmbedding rows).
if ad is visible 'label="No analysis branches yet."' >/dev/null 2>&1; then
  echo "✗ FAIL: Tree loaded but the taxonomy is EMPTY on this server."
  echo "        The target server's DB has zero CategoryEmbedding rows for this owner."
  echo "        That means the worker never ran classification there (CLASSIFY_ENABLED"
  echo "        =false or no GEMINI_API_KEY), or nothing has been ingested+classified yet."
  exit 1
fi

# Success: the Categories segment shows a count and at least the top branch.
echo "→ asserting category outline rendered"
ad wait text "SECTION V — THE OBSERVATORY" 4000 >/dev/null
ad wait text "analysis" 4000 >/dev/null

echo "→ capturing evidence"
ad screenshot /tmp/tree-categories.png >/dev/null
echo "✓ PASS: Tree category outline rendered. Screenshot → /tmp/tree-categories.png"
