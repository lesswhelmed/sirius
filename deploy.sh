#!/usr/bin/env bash
# Production deploy script for sirius-2-simple. Idempotent; safe to re-run.
# Runs ON THE SERVER inside the app checkout (/home/deploy/apps/sirius).
# Assumes:
#   - bun + pm2 installed on the host (loaded via ~/.bashrc)
#   - this repo is the deploy checkout (run from its root)
#   - .env populated with DATABASE_URL, INGEST_TOKEN, GEMINI_API_KEY, etc.
#
# Build/rollback model (shared-server protocol):
#   apps/web/.next-builds/<deploy-id>/   timestamped builds
#   apps/web/.next-builds/current ->     symlink to the active build
#   PM2 sirius-web runs `next start` with BUILD_DIR=.next-builds/current.
set -euo pipefail

cd "$(dirname "$0")"

WEB_BUILDS_DIR="apps/web/.next-builds"
DEPLOY_ID="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
KEEP_BUILDS=3

# The worker extracts video poster frames via ffmpeg (apps/worker/src/pipeline/
# video-thumbnail.ts). It degrades gracefully when ffmpeg is absent, so a failed
# install here is a WARNING, not a hard stop — never let an optional dep break a
# deploy. Idempotent + safe: skips apt entirely when ffmpeg is already present,
# and uses `sudo -n` so a host without passwordless sudo warns instead of hanging.
echo "==> ensure system deps (ffmpeg)"
if command -v ffmpeg >/dev/null 2>&1; then
  echo "    ffmpeg present: $(ffmpeg -version 2>/dev/null | head -1)"
elif sudo -n true 2>/dev/null; then
  echo "    ffmpeg missing — installing via apt..."
  if sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq \
     && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg; then
    echo "    installed: $(ffmpeg -version 2>/dev/null | head -1)"
  else
    echo "    WARNING: ffmpeg install failed; video thumbnails will be skipped" >&2
  fi
else
  echo "    WARNING: ffmpeg missing and no passwordless sudo — install manually:" >&2
  echo "             sudo apt-get install -y ffmpeg   (or set FFMPEG_PATH in .env)" >&2
fi

echo "==> git pull"
git pull --ff-only origin main

echo "==> bun install"
bun install --frozen-lockfile

echo "==> prisma generate"
bun run db:generate

echo "==> prisma migrate deploy"
bun run db:migrate:deploy

# Next.js encrypts Server Action closures with this key. It MUST be byte-identical
# at build time and at runtime, and stable across deploys — otherwise browser tabs
# loaded from a prior build hit "Failed to find Server Action" after every redeploy.
# We pull it from .env here so the build (this shell, passed through via turbo.json
# globalEnv) and the pm2 runtime (apps load root .env via dotenv) use the same value.
# Generate once with: openssl rand -base64 32
echo "==> resolve Server Action encryption key"
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(grep -E '^NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=' .env | cut -d= -f2- || true)"
if [ -z "${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-}" ]; then
  echo "ERROR: NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is missing/empty in .env" >&2
  echo "       Add a stable key to .env first: openssl rand -base64 32" >&2
  exit 1
fi
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY

echo "==> turbo build (BUILD_DIR=$WEB_BUILDS_DIR/$DEPLOY_ID)"
mkdir -p "$WEB_BUILDS_DIR"
# distDir in apps/web/next.config.js reads BUILD_DIR; relative to apps/web cwd.
BUILD_DIR=".next-builds/$DEPLOY_ID" bun run build

echo "==> symlink current -> $DEPLOY_ID"
ln -sfn "$DEPLOY_ID" "$WEB_BUILDS_DIR/current"

echo "==> pm2 startOrReload"
pm2 startOrReload ecosystem.config.cjs --update-env

# Warm the embedding-scene reverse-lookup index (Observatory / mobile Tree):
# embed projects + posts, then smoke-check the scene. The taxonomy is grown
# entirely from user content (dynamic topics/* nodes) — no seed facets.
# Idempotent — every step skips already-embedded rows — so it's safe on re-run.
echo "==> scene backfill"
bun run scene:backfill

echo "==> pm2 save"
pm2 save

echo "==> prune old builds (keep $KEEP_BUILDS)"
(
  cd "$WEB_BUILDS_DIR"
  # List build dirs newest-first, skip the symlink, drop the newest KEEP_BUILDS.
  ls -1dt -- */ 2>/dev/null | grep -v '^current/' | tail -n "+$((KEEP_BUILDS + 1))" | xargs -r rm -rf
)

echo "==> pm2 status"
pm2 status

echo "==> done"
