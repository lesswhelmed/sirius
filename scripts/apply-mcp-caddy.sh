#!/usr/bin/env bash
# Apply the mcp.lesswhelmed.com Caddy site block to the SHARED live host.
#
# Run from your Mac:  bash scripts/apply-mcp-caddy.sh
#
# What it does (safely):
#   1. Local DNS preflight — warns if mcp.lesswhelmed.com doesn't resolve yet.
#   2. Ships a guarded merge script to the server and runs it under `sudo`
#      (ssh -t gives sudo a TTY for your password).
#   3. The remote script: backs up /etc/caddy/Caddyfile, APPENDS ONLY the
#      mcp.lesswhelmed.com block (never touches copt.dev / www.copt.dev /
#      brotanicaldistro.com / lesswhelmed.com), `caddy fmt` + `caddy validate`,
#      confirms all FIVE sites are still present, and ONLY THEN reloads Caddy.
#      If validate fails or any site went missing, it RESTORES the backup and
#      exits WITHOUT reloading. Idempotent: re-running when the block already
#      exists just re-validates + reloads.
#   4. Verifies the new endpoint + the four existing sites still return 200.
#
# The app itself is already live (PM2 sirius-mcp on :3005, /health 200) — this
# script only wires the public reverse proxy. See infra/caddy/README.md.
set -euo pipefail

HOST="${DEPLOY_HOST:-172.239.45.200}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_copt_dev_v1}"
SSH_KEY="${SSH_KEY/#\~/$HOME}"
DOMAIN="mcp.lesswhelmed.com"
IP="$HOST"
TARGET="deploy@${HOST}"
REMOTE_TMP="/tmp/apply-mcp-caddy.remote.$$.sh"

echo "==> 1/4  DNS preflight: $DOMAIN"
resolved="$(dig +short "$DOMAIN" A 2>/dev/null | tail -1 || true)"
if [ "$resolved" = "$IP" ]; then
  echo "    OK: $DOMAIN -> $resolved"
else
  echo "    WARNING: $DOMAIN does not resolve to $IP yet (got: '${resolved:-none}')."
  echo "    Caddy can't issue the TLS cert until it does. You can still proceed —"
  echo "    Caddy will keep retrying the cert in the background once DNS propagates."
  printf "    Continue anyway? [y/N] "
  read -r ans
  case "$ans" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "    Aborted. Add the A record (mcp -> $IP), wait for dig, re-run."; exit 1 ;;
  esac
fi

echo "==> 2/4  generate guarded remote merge script"
LOCAL_TMP="$(mktemp -t apply-mcp-caddy.XXXXXX)"
trap 'rm -f "$LOCAL_TMP"' EXIT

# Outer delimiter is quoted ('REMOTE') so NOTHING below is expanded locally —
# $CF, $(date), {remote_host}, and the inner BLOCK heredoc are sent verbatim and
# evaluated on the server.
cat > "$LOCAL_TMP" <<'REMOTE'
set -euo pipefail
CF=/etc/caddy/Caddyfile
BK="${CF}.bak.$(date +%Y%m%d-%H%M%S)"

cp "$CF" "$BK"
echo "    backup: $BK"

if grep -qF 'mcp.lesswhelmed.com {' "$CF"; then
  echo "    mcp.lesswhelmed.com block already present — skipping append, will re-validate."
else
  tee -a "$CF" >/dev/null <<'BLOCK'

mcp.lesswhelmed.com {
	header {
		X-Frame-Options "SAMEORIGIN"
		X-Content-Type-Options "nosniff"
		X-XSS-Protection "1; mode=block"
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		-Server
	}

	encode gzip zstd

	reverse_proxy 127.0.0.1:3005 {
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-Host {host}
	}
}
BLOCK
  echo "    appended mcp.lesswhelmed.com block"
fi

caddy fmt --overwrite "$CF"

if ! caddy validate --config "$CF" --adapter caddyfile; then
  echo "    VALIDATE FAILED — restoring backup, NOT reloading." >&2
  cp "$BK" "$CF"
  exit 1
fi

missing=0
for s in 'copt.dev {' 'www.copt.dev {' 'brotanicaldistro.com {' 'lesswhelmed.com {' 'mcp.lesswhelmed.com {'; do
  if grep -qF "$s" "$CF"; then echo "    ok: $s"; else echo "    MISSING: $s" >&2; missing=1; fi
done
if [ "$missing" -ne 0 ]; then
  echo "    A SITE WENT MISSING — restoring backup, NOT reloading." >&2
  cp "$BK" "$CF"
  exit 1
fi

systemctl reload caddy
echo "    caddy reloaded."
REMOTE

echo "==> 3/4  ship + run on $TARGET (sudo will prompt for your password)"
scp -q -i "$SSH_KEY" "$LOCAL_TMP" "${TARGET}:${REMOTE_TMP}"
ssh -t -i "$SSH_KEY" "$TARGET" "sudo bash '${REMOTE_TMP}'; rc=\$?; rm -f '${REMOTE_TMP}'; exit \$rc"

echo "==> 4/4  verify (cert may take a few seconds on first hit)"
sleep 3
curl -sS -o /dev/null -w "    %{http_code}  https://${DOMAIN}/health\n" "https://${DOMAIN}/health" || \
  echo "    (mcp not 200 yet — if DNS just propagated, give Caddy ~30s for the cert, then re-curl)"
for u in https://copt.dev https://www.copt.dev https://brotanicaldistro.com https://lesswhelmed.com; do
  curl -s -o /dev/null -w "    %{http_code}  $u\n" "$u"
done

echo "==> done. If mcp.health is 200, smoke it end-to-end with a real key:"
echo "    MCP_SMOKE_KEY=<key> MCP_SMOKE_URL=https://${DOMAIN}/mcp bun --cwd apps/mcp smoke"
