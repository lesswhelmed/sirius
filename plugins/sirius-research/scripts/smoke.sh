#!/usr/bin/env bash
# Blackbox smoke for the sirius-research plugin.
#   1. probes the sirius-corpus server's /health
#   2. runs scripts/smoke.ts against it (all 9 tools + 2 resources + 3 prompts)
#
# Requires SIRIUS_MCP_API_KEY (a plaintext Sirius API key — mint at /settings →
# API Keys, or POST /api/app/api-keys). Optional SIRIUS_MCP_URL
# (default http://localhost:3005/mcp).
#
#   SIRIUS_MCP_API_KEY=<key> bash plugins/sirius-research/scripts/smoke.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# repo root = plugins/sirius-research/scripts -> up 3
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

URL="${SIRIUS_MCP_URL:-http://localhost:3005/mcp}"
HEALTH="${URL%/mcp}/health"

if [[ -z "${SIRIUS_MCP_API_KEY:-${MCP_SMOKE_KEY:-}}" ]]; then
  echo "error: set SIRIUS_MCP_API_KEY=<plaintext api key>" >&2
  exit 2
fi

echo "== health: $HEALTH =="
if ! curl -fsS -m 5 "$HEALTH"; then
  echo
  echo "error: server not responding. Start it with: bun --cwd apps/mcp dev" >&2
  exit 1
fi
echo

echo "== running smoke.ts =="
cd "$REPO_ROOT"
exec bun run plugins/sirius-research/scripts/smoke.ts
