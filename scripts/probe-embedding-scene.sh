#!/usr/bin/env bash
# Reusable agent-browser workflow: authenticate against a Sirius host, pull the
# raw GET /api/app/embedding-scene payload (the EXACT data the mobile Tree tab
# AND web /space consume), and analyze its spectrum — node/edge kinds, category
# depth distribution, dimensionality, embedding model version, emptiness.
#
# Why a browser: the endpoint is session-cookie gated. We log in once in a real
# browser, then `eval` an in-page fetch so the session cookie rides along — no
# token juggling. Web /space and mobile Tree hit the identical endpoint, so this
# faithfully reproduces what a production mobile build would receive.
#
# Usage:
#   HOST=https://sirius.local EMAIL=you@example.com PASSWORD=... scripts/probe-embedding-scene.sh
#   # PASSWORD falls back to DEV_LOGIN_PASSWORD in .env if unset.
#
# Env:
#   HOST     (default https://sirius.local)   server to probe
#   EMAIL    (default saleebmina@icloud.com)  account to sign in as
#   PASSWORD (default $DEV_LOGIN_PASSWORD)     password
#   SESSION  (default scene-probe)             agent-browser session name
set -euo pipefail

HOST="${HOST:-https://sirius.local}"
EMAIL="${EMAIL:-saleebmina@icloud.com}"
SESSION="${SESSION:-scene-probe}"
if [[ -z "${PASSWORD:-}" ]]; then
  PASSWORD="$(grep '^DEV_LOGIN_PASSWORD=' "$(git rev-parse --show-toplevel)/.env" 2>/dev/null | cut -d= -f2- || true)"
fi
ab() { agent-browser "$@" --session "$SESSION"; }

echo "→ opening ${HOST}/space"
ab open "${HOST}/space" >/dev/null
sleep 1

# Gated routes 302 to /sign-in. If so, authenticate.
URL="$(ab get url 2>/dev/null || true)"
if [[ "$URL" == *"/sign-in"* ]]; then
  echo "→ signing in as ${EMAIL}"
  EMAIL_REF="$(ab snapshot -i 2>/dev/null | grep -iE 'textbox "EMAIL"' | grep -oE 'ref=e[0-9]+' | grep -oE 'e[0-9]+' | head -1)"
  PASS_REF="$(ab snapshot -i 2>/dev/null | grep -iE 'textbox "PASSWORD"' | grep -oE 'ref=e[0-9]+' | grep -oE 'e[0-9]+' | head -1)"
  ab fill "@${EMAIL_REF}" "$EMAIL" >/dev/null
  ab fill "@${PASS_REF}" "$PASSWORD" >/dev/null
  ab click "$(ab snapshot -i 2>/dev/null | grep -iE 'button "SIGN IN"' | grep -oE 'ref=e[0-9]+' | grep -oE 'e[0-9]+' | head -1 | sed 's/^/@/')" >/dev/null
  sleep 3
  if ab eval "document.body.innerText" 2>/dev/null | grep -qi "Invalid email or password"; then
    echo "✗ FAIL: login rejected on ${HOST} (account/password not valid on this realm)."
    echo "        Prod (lesswhelmed.com) is a SEPARATE auth realm from dev — supply prod creds."
    exit 2
  fi
fi

echo "→ fetching + analyzing /api/app/embedding-scene (in-page, cookie-authed)"
# Clear network log so the filtered dump below shows only our call.
ab network requests --clear >/dev/null 2>&1 || true

ANALYSIS="$(ab eval --stdin <<'JS'
(async () => {
  const res = await fetch('/api/app/embedding-scene', { credentials: 'include' });
  if (!res.ok) return JSON.stringify({ status: res.status, error: (await res.text()).slice(0, 200) });
  const s = await res.json();
  const nodes = s.nodes || [], edges = s.edges || [];
  const tally = (arr, key) => arr.reduce((m, x) => (m[x[key]] = (m[x[key]] || 0) + 1, m), {});
  const cats = nodes.filter(n => n.kind === 'category');
  const posts = nodes.filter(n => n.kind === 'post');
  const matchedPosts = new Set(edges.filter(e => e.kind === 'match').map(e => e.from));
  return JSON.stringify({
    status: res.status,
    modelVersion: s.modelVersion,
    dimensionality: s.dimensionality,
    totals: { nodes: nodes.length, edges: edges.length },
    nodesByKind: tally(nodes, 'kind'),
    edgesByKind: tally(edges, 'kind'),
    categoryDepth: tally(cats, 'depth'),
    rootCategories: cats.filter(c => !c.parentPath).map(c => c.label),
    postsWithCategoryMatch: matchedPosts.size,
    postsTotal: posts.length,
    empty: cats.length === 0,
  }, null, 2);
})()
JS
)"
echo "── embedding-scene spectrum (${HOST}) ──"
echo "$ANALYSIS"

echo "── raw request line ──"
ab network requests --filter embedding-scene 2>/dev/null | head -5 || true

if echo "$ANALYSIS" | grep -q '"empty": true'; then
  echo "⚠ taxonomy is EMPTY on ${HOST} — mobile Tree would show 'No analysis branches yet.'"
  exit 1
fi
echo "✓ taxonomy present on ${HOST}"
