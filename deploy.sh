#!/usr/bin/env bash
# Production deploy script for sirius-2-simple. Idempotent; safe to re-run.
# Assumes:
#   - bun + pm2 installed on the host
#   - this repo is the deploy checkout (run from its root)
#   - .env populated with DATABASE_URL, INGEST_TOKEN, GEMINI_API_KEY, etc.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> git pull"
git pull --ff-only origin main

echo "==> bun install"
bun install --frozen-lockfile

echo "==> prisma generate"
bun run db:generate

echo "==> prisma migrate deploy"
bun run db:migrate:deploy

echo "==> turbo build"
bun run build

echo "==> pm2 startOrReload"
pm2 startOrReload ecosystem.config.cjs --update-env

echo "==> pm2 save"
pm2 save

echo "==> done"
