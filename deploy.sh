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

# Compute DEPLOY_ID AFTER the pull so the .next-builds/<id> dir is labeled with the
# commit actually checked out + built (not the pre-pull HEAD). Mislabeling here was
# purely cosmetic but misleading during incident triage.
DEPLOY_ID="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"

# --- Preflight: per-app env wiring -------------------------------------------
# Every app loads the repo-root .env via a per-app symlink (apps/<app>/.env ->
# ../../.env) that Bun auto-loads from the process CWD. Those symlinks are tracked
# in git, but a missing/broken one silently strips the env: the app boots with no
# DATABASE_URL / BETTER_AUTH_SECRET and crash-loops (better-auth throws "default
# secret" in production) or runs misconfigured. That was a real outage (sirius-mcp,
# 2026-06-22: its symlink was never created on the host). Catch it HERE, before the
# build, instead of shipping a crash-loop. Self-heal a missing symlink, then assert
# the boot-critical vars are actually visible to a Bun process in each app's CWD.
echo "==> preflight: per-app env wiring"

ensure_env_symlink() {
	if [ ! -e "apps/$1/.env" ]; then
		echo "    apps/$1/.env missing/broken -> recreating symlink"
		ln -sfn ../../.env "apps/$1/.env"
	fi
}

# Asserts each required var is visible to a Bun process in apps/<app>'s CWD,
# exactly as the app loads env at boot. Self-aborts the deploy on failure with an
# explicit `exit 1` — do NOT rely on `set -e` here: macOS bash 3.2 (and some
# others) don't abort when a function's trailing command is a failing subshell.
require_app_env() {
	local app="$1"; shift
	if ! ( cd "apps/$app" && NEEDED="$*" APP="$app" bun -e '
		const need = (process.env.NEEDED || "").split(/\s+/).filter(Boolean);
		const missing = need.filter((k) => !process.env[k]);
		if (missing.length) {
			console.error(`    apps/${process.env.APP}: MISSING env [${missing.join(", ")}] — check apps/${process.env.APP}/.env -> root .env`);
			process.exit(1);
		}
		console.log(`    apps/${process.env.APP}: env OK (${need.length} required vars visible)`);
	' ); then
		echo "==> DEPLOY ABORTED: apps/$app env preflight failed (see above)" >&2
		exit 1
	fi
}

ensure_env_symlink web
ensure_env_symlink worker
ensure_env_symlink mcp
require_app_env web BETTER_AUTH_SECRET DATABASE_URL
require_app_env worker DATABASE_URL
require_app_env mcp BETTER_AUTH_SECRET DATABASE_URL

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

# Warm the PRECOMPUTED scene cache (kNN neighbors + force layout) for existing
# owners. The scene_precompute migration only creates the empty tables; this
# enqueues a (deduped) recompute per owner with embeddings, which the running
# worker drains — so existing users don't pay a cold live-compute on first view.
# Idempotent + non-fatal: a failure here must not abort the deploy.
echo "==> scene cache backfill (enqueue recomputes)"
bun run scene:backfill:cache || echo "WARN scene cache backfill failed (non-fatal; cold reads self-heal)"

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
