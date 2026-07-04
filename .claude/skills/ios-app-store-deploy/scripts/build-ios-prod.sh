#!/usr/bin/env bash
# build-ios-prod.sh — preflight + kick + poll a Sirius iOS PRODUCTION EAS build,
# then EITHER submit non-interactively (if ASC API-key env vars are present) OR
# print the exact interactive-submit handoff command for the human.
#
# What it does (in order):
#   1. `db:generate` (mobile typecheck transitively pulls in @repo/*)
#   2. mobile typecheck (fails BEFORE consuming a build)
#   3. assert a clean, committed git tree (EAS requireCommit: true builds the
#      committed tree only — a dirty tree would refuse or build stale code)
#   4. verify the on-device-AI native bridge (verify:native-ai) — same gate EAS runs
#   5. kick `eas build --profile production --platform ios` and poll to terminal state
#   6. submit: non-interactive iff EXPO_APPLE_API_KEY_* are all set, else handoff
#
# This is the AGENT-SAFE lane. It never touches App Store Connect UI, never
# records the reviewer video, never posts to the Resolution Center — those stay
# with the human (see SKILL.md "Human-required lane").
#
# Usage:
#   .claude/skills/ios-app-store-deploy/scripts/build-ios-prod.sh            # build + poll + submit-or-handoff
#   BUILD_ONLY=1 .claude/skills/ios-app-store-deploy/scripts/build-ios-prod.sh  # stop after a FINISHED build
#   REUSE_LATEST=1 .claude/skills/ios-app-store-deploy/scripts/build-ios-prod.sh # skip building; use latest FINISHED prod build
#
# Env:
#   BUILD_ONLY=1     build + poll, then stop (no submit, no handoff prompt)
#   REUSE_LATEST=1   don't build — resolve the latest FINISHED production iOS build
#   EXPO_APPLE_API_KEY_PATH / EXPO_APPLE_API_KEY_ID / EXPO_APPLE_API_ISSUER_ID
#                    when ALL three are set, submit runs `--non-interactive`;
#                    otherwise the script prints the interactive submit command.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"

need() { command -v "$1" >/dev/null 2>&1 || { echo "✖ missing '$1' — $2"; exit 1; }; }
need bunx "install bun (https://bun.sh)"
need node "needed to parse eas build:list / build:view JSON"
need git  "needed for the clean-tree check"

# ── Resolve a build id: either an existing FINISHED one (REUSE_LATEST) or a fresh build ──
resolve_latest_finished() {
  cd "$MOBILE_DIR"
  bunx eas-cli build:list --platform ios --limit 15 --non-interactive --json 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const b=(JSON.parse(d)||[]).find(x=>x.status==="FINISHED"&&x.buildProfile==="production");if(!b){console.error("no finished production build found");process.exit(1)}process.stdout.write(b.id)})'
}

BUILD_ID=""

if [ "${REUSE_LATEST:-}" = "1" ]; then
  echo "→ REUSE_LATEST=1 — resolving the latest FINISHED production iOS build…"
  BUILD_ID="$(resolve_latest_finished)" || { echo "✖ no finished production build to reuse"; exit 1; }
  echo "  reusing build: $BUILD_ID"
else
  echo "→ preflight 1/4: db:generate (mobile typecheck pulls in @repo/*)…"
  (cd "$REPO_ROOT" && bun run db:generate >/dev/null)

  echo "→ preflight 2/4: mobile typecheck…"
  (cd "$MOBILE_DIR" && bun run check-types)

  echo "→ preflight 3/4: clean-tree check (EAS requireCommit builds the committed tree)…"
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
    echo "✖ working tree is dirty. Commit (or stash) everything first — EAS builds the"
    echo "  committed tree only, so uncommitted work would ship stale or refuse to build."
    git -C "$REPO_ROOT" status --short
    exit 1
  fi

  echo "→ preflight 4/4: verify on-device-AI native bridge…"
  (cd "$MOBILE_DIR" && bun run verify:native-ai)

  echo "→ kicking EAS production iOS build (non-interactive; EAS owns the build number)…"
  BUILD_ID="$(cd "$MOBILE_DIR" && bunx eas-cli build --profile production --platform ios --non-interactive --no-wait --json 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j;try{j=JSON.parse(d)}catch(e){console.error("could not parse eas build JSON");process.exit(1)}const b=Array.isArray(j)?j[0]:j;if(!b||!b.id){console.error("no build id in eas build output");process.exit(1)}process.stdout.write(b.id)})')"
  [ -n "$BUILD_ID" ] || { echo "✖ could not determine the new build id"; exit 1; }
  echo "  build id: $BUILD_ID"
  echo "  logs: https://expo.dev/accounts/minasaleeb/projects/sirius/builds/$BUILD_ID"

  echo "→ polling until the build reaches a terminal state…"
  while :; do
    STATUS="$(cd "$MOBILE_DIR" && bunx eas-cli build:view "$BUILD_ID" --json 2>/dev/null \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write((JSON.parse(d)||{}).status||"")}catch(e){process.stdout.write("")}})')"
    case "$STATUS" in
      FINISHED) echo "  ✔ FINISHED"; break ;;
      ERRORED|CANCELED) echo "  ✖ build $STATUS — open the logs URL above, read the failing phase, fix the root cause."; exit 1 ;;
      "")       echo "  …status unknown, retrying in 30s"; sleep 30 ;;
      *)        echo "  …$STATUS (checking again in 30s)"; sleep 30 ;;
    esac
  done
fi

if [ "${BUILD_ONLY:-}" = "1" ]; then
  echo "✔ BUILD_ONLY=1 — stopping at a FINISHED build ($BUILD_ID)."
  echo "  Submit later with: cd apps/mobile && bunx eas-cli submit --profile production --platform ios --id $BUILD_ID"
  exit 0
fi

# ── Submit lane: non-interactive iff all three ASC API-key vars are present ──
if [ -n "${EXPO_APPLE_API_KEY_PATH:-}" ] && [ -n "${EXPO_APPLE_API_KEY_ID:-}" ] && [ -n "${EXPO_APPLE_API_ISSUER_ID:-}" ]; then
  echo "→ ASC API key detected — submitting non-interactively…"
  (cd "$MOBILE_DIR" && bunx eas-cli submit --profile production --platform ios --id "$BUILD_ID" --non-interactive)
  echo "✔ uploaded to App Store Connect. It now 'processes' (minutes to ~1h) before it can be selected on the version."
else
  cat <<EOF
✔ Build $BUILD_ID is FINISHED, but submit needs an interactive Apple login (no ASC API
  key in the environment). This is the HUMAN handoff — run:

    cd apps/mobile && bunx eas-cli submit --profile production --platform ios --id $BUILD_ID
    # (or: bun run mobile:submit:ios  — targets --latest)

  To make submit non-interactive, export EXPO_APPLE_API_KEY_PATH, EXPO_APPLE_API_KEY_ID,
  and EXPO_APPLE_API_ISSUER_ID (a .p8 App Store Connect API key) and re-run this script.

  After the binary processes, the remaining App-Store-Connect + review steps are still
  human-only — see SKILL.md "Human-required lane".
EOF
fi
