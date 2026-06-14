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

echo "==> git pull"
git pull --ff-only origin main

echo "==> bun install"
bun install --frozen-lockfile

echo "==> prisma generate"
bun run db:generate

echo "==> prisma migrate deploy"
bun run db:migrate:deploy

echo "==> turbo build (BUILD_DIR=$WEB_BUILDS_DIR/$DEPLOY_ID)"
mkdir -p "$WEB_BUILDS_DIR"
# distDir in apps/web/next.config.js reads BUILD_DIR; relative to apps/web cwd.
BUILD_DIR=".next-builds/$DEPLOY_ID" bun run build

echo "==> symlink current -> $DEPLOY_ID"
ln -sfn "$DEPLOY_ID" "$WEB_BUILDS_DIR/current"

echo "==> pm2 startOrReload"
pm2 startOrReload ecosystem.config.cjs --update-env

# Warm the embedding-scene reverse-lookup index (Observatory / mobile Tree):
# seed the analysis taxonomy, embed projects + posts, then smoke-check the scene.
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
