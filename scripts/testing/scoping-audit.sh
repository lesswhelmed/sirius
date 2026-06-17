#!/usr/bin/env bash
# Cross-user data-isolation guardrail. Proves that a signed-in user (B) can
# NEVER see another user's (A) private data through the session-authed
# /api/app/* surface. Run this after touching any (app) route or a `@repo/db`
# read helper — it is the regression test for the 2026-06 queue-leak class.
#
# Pure HTTP + DB (curl + jq + psql, no browser): seeds two marker rows OWNED BY
# A directly by id (so it needs NO password for A), signs in as B over the
# better-auth API, then asserts from B's session that:
#   - /api/app/queue and /api/app/posts return zero rows owned by A;
#   - /api/app/posts/<A-slug> and .../export return 404.
# Marker rows are torn down on exit.
#
# Requires (in scripts/testing/.creds.local):
#   TEST_EMAIL                      -> user A (the data owner whose id we seed against)
#   TEST_EMAIL_B / TEST_PASSWORD_B  -> user B, a second VERIFIED account (see bootstrap)
# Bootstrap B once (sign-up + flip emailVerified, mirroring bootstrap-user.sh):
#   curl -s -X POST "$BASE_URL/api/auth/sign-up/email" -H 'Content-Type: application/json' \
#     --data '{"name":"Audit B","email":"<B-email>","password":"<B-pass>"}'
#   psql "$(...)" -c "UPDATE \"user\" SET \"emailVerified\"=true WHERE email='<B-email>';"
#
# Usage: ./scoping-audit.sh
source "$(dirname "$0")/_lib.sh"
require_cmd curl jq psql

: "${TEST_EMAIL_B:?set TEST_EMAIL_B in .creds.local (a second, verified test user)}"
: "${TEST_PASSWORD_B:?set TEST_PASSWORD_B in .creds.local}"

MARKER_SLUG="audit-marker-post-a"
fail=0

# --- resolve user ids -------------------------------------------------------
a_id="$(psql_q "SELECT id FROM \"user\" WHERE email = '$TEST_EMAIL';")"
b_id="$(psql_q "SELECT id FROM \"user\" WHERE email = '$TEST_EMAIL_B';")"
[ -n "$a_id" ] || { echo "[error] user A ($TEST_EMAIL) not found" >&2; exit 1; }
[ -n "$b_id" ] || { echo "[error] user B ($TEST_EMAIL_B) not found — bootstrap it (see header)" >&2; exit 1; }
[ "$a_id" != "$b_id" ] || { echo "[error] A and B resolve to the same user" >&2; exit 1; }
log "user A=$a_id  user B=$b_id"

# --- seed A-owned marker rows (idempotent) ----------------------------------
seed_sql="
INSERT INTO \"IngestSubmission\" (id, kind, payload, \"contentHash\", status, \"submittedById\", \"updatedAt\")
VALUES ('audit-sub-a', 'note', '{}'::jsonb, 'audit-marker-sub-a', 'completed', '$a_id', now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO \"Post\" (id, slug, title, content, type, status, \"filePath\", \"fileHash\", \"submittedById\", \"updatedAt\", \"lastEdited\")
VALUES ('audit-post-a', '$MARKER_SLUG', 'AUDIT marker (A, private)', 'private draft body', 'BLOG'::\"PostType\", 'DRAFT'::\"PostStatus\", 'audit/marker', 'audit-marker', '$a_id', now(), now())
ON CONFLICT (id) DO NOTHING;
"
jar="$(mktemp)"
teardown() {
  psql_q "DELETE FROM \"IngestSubmission\" WHERE id = 'audit-sub-a'; DELETE FROM \"Post\" WHERE id = 'audit-post-a';" >/dev/null 2>&1 || true
  rm -f "$jar"
}
trap teardown EXIT

log "seeding A-owned marker rows"
psql_q "$seed_sql" >/dev/null

# --- sign in as B over the better-auth API ----------------------------------
log "signing in as B ($TEST_EMAIL_B)"
body="$(jq -nc --arg e "$TEST_EMAIL_B" --arg p "$TEST_PASSWORD_B" '{email:$e,password:$p}')"
code="$(curl -s -o /dev/null -w "%{http_code}" -c "$jar" -H 'Content-Type: application/json' \
  -X POST "$BASE_URL/api/auth/sign-in/email" --data "$body" --max-time 20)"
[ "$code" = "200" ] || { echo "[error] B sign-in failed (http $code) — is B verified?" >&2; exit 1; }
who="$(curl -s -b "$jar" "$BASE_URL/api/auth/get-session" --max-time 15 | jq -r '.user.id // empty')"
[ "$who" = "$b_id" ] || { echo "[error] B session not established (got '$who')" >&2; exit 1; }

# bget <path> -> response body on stdout (with B's cookie)
bget() { curl -s -b "$jar" "$BASE_URL$1" --max-time 20; }
# bcode <path> -> HTTP status only
bcode() { curl -s -o /dev/null -w "%{http_code}" -b "$jar" "$BASE_URL$1" --max-time 20; }

assert() { # assert <label> <condition-cmd...>
  local label="$1"; shift
  if "$@"; then echo "  PASS $label"; else echo "  FAIL $label  <-- LEAK" >&2; fail=1; fi
}

# --- assertions -------------------------------------------------------------
log "checking /api/app/queue does not expose A's submissions"
q="$(bget "/api/app/queue?limit=500")"
assert "queue: no row owned by A"        bash -c "! echo '$q' | jq -e --arg a '$a_id' '[.items[].submittedById] | any(.==\$a)' >/dev/null"
assert "queue: marker submission absent" bash -c "! echo '$q' | jq -e '[.items[].id] | any(.==\"audit-sub-a\")' >/dev/null"

log "checking /api/app/posts does not expose A's posts"
p="$(bget "/api/app/posts?limit=500")"
assert "posts: no row owned by A"  bash -c "! echo '$p' | jq -e --arg a '$a_id' '[.items[].submittedById] | any(.==\$a)' >/dev/null"
assert "posts: marker post absent" bash -c "! echo '$p' | jq -e '[.items[].id] | any(.==\"audit-post-a\")' >/dev/null"

log "checking single-post + export of A's slug return 404 for B"
assert "GET /api/app/posts/$MARKER_SLUG -> 404"        test "$(bcode "/api/app/posts/$MARKER_SLUG")" = "404"
assert "GET /api/app/posts/$MARKER_SLUG/export -> 404" test "$(bcode "/api/app/posts/$MARKER_SLUG/export")" = "404"

# --- verdict ----------------------------------------------------------------
if [ "$fail" -ne 0 ]; then
  echo "[FAIL] cross-user data leak detected — see FAIL lines above" >&2
  exit 1
fi
log "[PASS] no cross-user data exposure on the audited endpoints"
