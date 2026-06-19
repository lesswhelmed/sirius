#!/usr/bin/env bash
# Pull the latest code, then build + install + launch the Sirius mobile DEV client on the
# phone over Wi-Fi (adb wireless debugging) + start Metro. One command for a fresh cycle.
#
# Usage:
#   ./dev-wireless.sh                       # pull, then reuse last wireless endpoint
#   ./dev-wireless.sh 192.168.50.89:43027   # pull, then connect to this IP:PORT (and remember it)
#
# When to pass an IP:PORT: after the phone reboots or sleeps, the Wireless-debugging
# CONNECT port rotates. Grab the new one from
#   Settings > Developer options > Wireless debugging
# and pass it once; afterwards the bare command works again.
#
# Pairing is one-time (adb pair <ip>:<pairPort> <code>). Skip the rebuild with:
# NO_BUILD=1 ./dev-wireless.sh
#
# Works from any branch:
#   - branch tracks a remote      -> pull --rebase --autostash from its upstream
#   - branch has no upstream       -> build it as-is (just fetch; no pull, no error)
#   - PULL_BASE=main ./dev-wireless.sh -> rebase the current branch onto origin/main first
#
# (Ported from PenguinSlide/android-libgdx/dev-wireless.sh, adapted to the Expo dev client.)

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
GIT() { git -C "$REPO_ROOT" "$@"; }

BRANCH="$(GIT rev-parse --abbrev-ref HEAD)"
echo "==> Fetching origin (branch: $BRANCH) ..."
GIT fetch --quiet origin || echo "    (fetch failed — continuing with local code)"

if [ -n "${PULL_BASE:-}" ]; then
    # Explicit: bring the current branch up to date on top of a mainline branch.
    echo "==> Rebasing '$BRANCH' onto origin/$PULL_BASE ..."
    GIT pull --rebase --autostash origin "$PULL_BASE"
elif GIT rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    # Branch tracks a remote: pull its upstream. --autostash preserves local edits,
    # --rebase keeps history linear.
    echo "==> Pulling latest into '$BRANCH' from its upstream ..."
    GIT pull --rebase --autostash
else
    echo "==> '$BRANCH' has no upstream — building it as-is (no pull)."
    echo "    To pull mainline instead: 'git checkout main', or 'PULL_BASE=main $0'."
fi

echo "==> Building debug dev client + deploying to phone over Wi-Fi ..."
exec "$HERE/wireless-run.sh" "$@"
