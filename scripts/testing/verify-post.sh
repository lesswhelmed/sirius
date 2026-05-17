#!/usr/bin/env bash
# Assert that a Post with the given slug shows up in /library and that the
# detail page at /posts/<slug> renders. Requires an authenticated session.
#
# Usage: ./verify-post.sh <slug>

source "$(dirname "$0")/_lib.sh"
require_cmd agent-browser

slug="${1:-}"
if [ -z "$slug" ]; then
  echo "usage: $0 <slug>" >&2
  exit 2
fi

log "checking /library for $slug"
ab open "$BASE_URL/library" >/dev/null
ab_wait --text "Library" >/dev/null

# Include link hrefs (-u) — the slug column is responsive-hidden on mobile
# widths so we anchor on the post detail href instead of visible text.
snapshot="$(ab snapshot -i -u 2>&1)"
if ! grep -q "/posts/$slug" <<<"$snapshot"; then
  echo "[error] /posts/$slug link not visible in /library snapshot" >&2
  exit 1
fi

log "opening /posts/$slug"
ab open "$BASE_URL/posts/$slug" >/dev/null
ab_wait --load networkidle >/dev/null

# Just confirm an <article> mounted — that's all we need to know the
# detail page rendered without 404'ing. Title text varies per post.
detail="$(ab snapshot 2>&1)"
if ! grep -q '^- article\| article$' <<<"$detail"; then
  echo "[error] /posts/$slug did not render an <article> element" >&2
  exit 1
fi

log "verified: post '$slug' present in library and detail renders"
