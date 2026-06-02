#!/usr/bin/env bash
# Local deploy orchestration for sirius-2-simple.
#   1. Load deploy config from .env.production
#   2. Push the deploy branch to origin
#   3. SSH into the shared server and run ./deploy.sh in the app checkout
#   4. Verify the public URL returns HTTP 200
#
# Run from the repo root: `bun run deploy`.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ $ENV_FILE not found. Run: bun run env:production" >&2
  exit 1
fi

# Load only the deploy-orchestration vars we need (don't export app secrets).
# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

DEPLOY_APP_NAME="${DEPLOY_APP_NAME:-sirius}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_HOST="${DEPLOY_HOST:-${DEPLOY_SERVER:-}}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_copt_dev_v1}"
DEPLOY_APP_DIR="${DEPLOY_APP_DIR:-/home/deploy/apps/sirius}"
DEPLOY_VERIFY_URL="${DEPLOY_VERIFY_URL:-https://lesswhelmed.com}"

if [[ -z "$DEPLOY_HOST" ]]; then
  echo "✗ DEPLOY_HOST (or DEPLOY_SERVER) is not set in $ENV_FILE" >&2
  exit 1
fi

# Expand a leading ~ in the key path so ssh -i resolves it.
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY/#\~/$HOME}"
SSH_TARGET="deploy@${DEPLOY_HOST}"

echo "==> deploying $DEPLOY_APP_NAME"
echo "==> push origin $DEPLOY_BRANCH"
git push origin "$DEPLOY_BRANCH"

echo "==> remote deploy ($SSH_TARGET:$DEPLOY_APP_DIR)"
ssh -i "$DEPLOY_SSH_KEY" "$SSH_TARGET" "cd '$DEPLOY_APP_DIR' && ./deploy.sh"

echo "==> verify $DEPLOY_VERIFY_URL"
status="$(curl -s -o /dev/null -w '%{http_code}' "$DEPLOY_VERIFY_URL" || echo '000')"
if [[ "$status" == "200" ]]; then
  echo "✓ $DEPLOY_VERIFY_URL returned $status"
else
  echo "✗ $DEPLOY_VERIFY_URL returned $status (expected 200)" >&2
  exit 1
fi

echo "==> done"
