#!/usr/bin/env bash
#
# Reproducible test database for the search harness.
#
# Derives a TEST_DATABASE_URL from the existing DATABASE_URL in .env (SAME role,
# host, port, and credentials — only the database name changes, default suffix
# "-test"), creates that database if missing, applies all Prisma migrations, and
# persists TEST_DATABASE_URL back into .env so `bun --cwd packages/db run
# test:search` and the integration harness pick it up.
#
# Idempotent: safe to run repeatedly. Pass --reset to drop + recreate the test DB
# from scratch (force-disconnects any open sessions).
#
# Usage:
#   bun run db:test:setup            # ensure + migrate
#   bun run db:test:setup -- --reset # drop, recreate, migrate
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "error: .env not found at repo root" >&2
  exit 1
fi

# Read DATABASE_URL from .env (strip "KEY=" and any surrounding quotes).
raw="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"
raw="${raw%\"}"; raw="${raw#\"}"; raw="${raw%\'}"; raw="${raw#\'}"
if [ -z "$raw" ]; then
  echo "error: DATABASE_URL not found in .env" >&2
  exit 1
fi
DATABASE_URL="$raw"

# Split into base (no query string) + query, then into connection + db name.
base="${DATABASE_URL%%\?*}"
if [ "$base" != "$DATABASE_URL" ]; then query="?${DATABASE_URL#*\?}"; else query=""; fi
dbname="${base##*/}"          # e.g. sirius-2-simple
conn="${base%/*}"            # e.g. postgresql://user:pass@localhost:5432

TEST_DB="${TEST_DB_NAME:-${dbname}-test}"
TEST_DATABASE_URL="${conn}/${TEST_DB}${query}"
admin_url="${conn}/postgres" # connect to the always-present "postgres" db for DDL

echo "Source database : $dbname"
echo "Test database   : $TEST_DB"

if [ "${1:-}" = "--reset" ]; then
  echo "Dropping $TEST_DB (force) ..."
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE);"
fi

if psql "$admin_url" -tAc "SELECT 1 FROM pg_database WHERE datname='$TEST_DB'" | grep -q 1; then
  echo "Database $TEST_DB already exists."
else
  echo "Creating database $TEST_DB ..."
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TEST_DB\";"
fi

# Persist TEST_DATABASE_URL to .env (do not clobber an existing entry).
if grep -qE '^TEST_DATABASE_URL=' .env; then
  echo "TEST_DATABASE_URL already present in .env (left unchanged)."
else
  printf '\n# Search test harness DB (created by scripts/setup-test-db.sh)\nTEST_DATABASE_URL="%s"\n' "$TEST_DATABASE_URL" >> .env
  echo "Appended TEST_DATABASE_URL to .env"
fi

# Apply migrations to the test DB. The inline DATABASE_URL wins over .env (dotenv
# does not override an already-set process env var).
echo "Applying migrations to $TEST_DB ..."
DATABASE_URL="$TEST_DATABASE_URL" bun --cwd=packages/db run db:migrate:deploy

echo ""
echo "Test DB ready: $TEST_DATABASE_URL"
