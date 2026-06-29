# Post-Visibility Privacy/Security Audit — 2026-06-29

Whole-platform audit of every **read path** (content *and* identity/relationship
metadata) against the relationship-based access-control model: posts carry a
`PostVisibility` tier (`PRIVATE` → `FRIENDS` → `GROUP` → `PUBLIC`), and reads must flow
through the one read gate (`canReadPost`) or the matching list builders
(`visibilityWhereForViewer`, `searchVisibilityWhere`).

**Bottom line.** The core access-control *engine* is solid: the read primitive and all
four list/SQL gates agree on every tier, the empty-`friendIds` trap is handled, `GROUP`
enforces membership **and** live friendship, unfriending cascades to revoke group access,
and revocation is per-request (no stale cache). Identity/metadata, retained originals,
archive tokens, MCP tenant isolation, and the mobile mirror are all clean.

The risk lives in the **composition layer**: `features.ts` claims `canReadPost` is "the
ONLY place the policy is applied — nothing else should hardcode it," but the public-tier
kill-switch (`PUBLIC_CATALOG_ENABLED`) was applied inconsistently across the catalog
helpers, the listing page, and search. Findings 1 and 2 share that single root cause and
are the argument for centralizing the public-tier policy (see the companion design spec).

## Findings

| # | Severity | Surface | Status |
|---|----------|---------|--------|
| 1 | HIGH (latent) | Catalog/storefront/listing gate on `status`, not `visibility === PUBLIC` | **Fixed** 2026-06-29 |
| 2 | MEDIUM (live) | `/api/app/search` ignored `PUBLIC_CATALOG_ENABLED` | **Fixed** 2026-06-29 |
| 3 | LOW | `/social/*` cover images slug-enumerable | Open — bead |
| 4 | LOW | `/api/app/posts/[slug]/save` skips `canReadPost` | Open — bead |
| 5 | LOW | Global `contentHash` dedup oracle | Open — bead |
| 6 | LOW (by design) | `bio` public via `/u/<handle>` invite card, no opt-out | Product decision |

### 1 — HIGH (latent): public composition paths gated on `status`, not visibility — FIXED

When `PUBLIC_CATALOG_ENABLED` flips on, every PUBLISHED post became world-readable
regardless of visibility — and since `visibility` defaults to `PRIVATE`, that's most posts,
exposed to *anonymous* visitors (full title, body, image, source URL). The comment at
`features.ts` ("Safe to flip on … exposes NOTHING until an owner marks a post PUBLIC") was
false for these paths — a loaded gun with a mislabeled safety.

Evidence (verified against source):
- `apps/web/app/(public)/listing/[slug]/page.tsx` — `publicOk = PUBLIC_CATALOG_ENABLED && status === PUBLISHED`, skipping `canReadPost` for any published post, no session required.
- `packages/db/src/posts.ts` `listCatalogPosts` / `listUserStorefront` — filtered `status: PUBLISHED` with **no** `visibility` filter.
- `apps/web/lib/features.ts` `ANONYMOUS_CATALOG_ENABLED` — defined but **referenced nowhere**; the promised "separate, stricter, anonymous" gate did not exist.

**Fix applied:** added a `visibility?` filter to `PostFilters`/`buildPostWhere` and set
`visibility: PUBLIC` in both catalog helpers; added `&& post.visibility === PUBLIC` to the
listing page's `publicOk`. Non-PUBLIC posts can no longer reach any public composition path,
independent of the flag. (Not exploitable pre-fix because both flags are `false`.) The
remaining nuance — wiring `ANONYMOUS_CATALOG_ENABLED` so anonymous access is a *stricter*
gate than signed-in cross-user access — is folded into the centralization design.

### 2 — MEDIUM (live): search ignored the public kill-switch — FIXED

`packages/db/src/search.ts` derived `const includePublic = scopeAll;` from `scope=all`
(the route default) and **never** from `PUBLIC_CATALOG_ENABLED` (`@repo/db` can't read the
web-only flag, and the route didn't pass it). So a signed-in user's search already returned
*other users'* PUBLIC posts (title + excerpt + snippet) cross-user while the catalog was
nominally disabled — diverging from `canReadPost`, which gates the PUBLIC tier behind the
flag. Bounded to posts an owner explicitly marked PUBLIC.

**Fix applied:** `searchCorpus` gained a `publicCatalogEnabled?: boolean` option (defaults
**false** — secure default); `includePublic = scopeAll && (opts.publicCatalogEnabled ?? false)`.
The web route threads `PUBLIC_CATALOG_ENABLED`; MCP is unaffected (`scope:"mine"`). The
golden-matrix integration test was extended with explicit flag-on (stranger PUBLIC visible)
and flag-off (stranger PUBLIC hidden, friends'-shared still visible) cases. **24/24 search
tests pass** against Postgres.

### 3 — LOW: `/social/*` cover images are slug-enumerable

`apps/worker/src/pipeline/post-writer.ts` names social cover files `${slug}.${ext}`, and the
slug is title-derived (random suffix only on collision). `/social/*` is a public capability
URL that bypasses `canReadPost` by design, so a *guessed* slug fetches a PRIVATE post's cover
image. (`/sight/*` is safe — keyed by a random `batchId` UUID.) **Fix:** `${slug}-${randomUUID()}.jpg`.

### 4 — LOW: `/api/app/posts/[slug]/save` skips the read gate

`save/route.ts` bookmarks any slug for any post id without a `canReadPost` check. No content
leak today (no saved-list reader exists, only an `isPostSaved` boolean), but it would leak the
moment a "Saved" view is added without re-gating. **Fix:** gate `save` on `canReadPost`.

### 5 — LOW: global `contentHash` dedup oracle

`packages/db/src/ingest.ts` dedups on a *globally* unique `contentHash`; on collision the
route returns the existing (possibly foreign) user's submission id + status. A holder of the
shared `INGEST_TOKEN` can confirm someone else ingested specific content. Bounded (shared
token, no body/owner leaked) and also a latent correctness bug (user B silently can't ingest
what user A already did). **Fix:** scope the dedup key to `(submittedById, contentHash)`.

### 6 — LOW (by design): `bio` public via invite card

`/u/<handle>` + its OG meta expose `bio` to anyone, including crawlers. Intentional for a
shareable invite card, but there's no way to keep only `handle` public. `location`, `email`,
and session fields are all correctly gated. **Decision, not a bug** — confirm product intent
or add a `bioPublic` flag.

## Verified clean (no action)

- Single-post `GET /api/app/posts/[slug]`, `(app)/posts/[slug]` page, `/export` — `canReadPost`, 404 on deny.
- Retained originals `/source`, `/notes`, `/original` — session **+ ownership** (stricter than read), traversal-confined.
- Archive download — 192-bit token, single-archive scoped, expiry enforced.
- MCP corpus (`apps/mcp`) — per-request server bound to the verified `referenceId`; every tool owner-scoped.
- Comments — `canReadPost` read/write gate; author-or-owner delete guard.
- Feed / search hits / embedding scene — peers' `shareGroups` stripped, `ownAudience` own-only; no group/relationship metadata leak.
- Friend-list enumeration — every `listFriends`/`listPendingRequests` scoped to `session.user.id`; no path returns another user's roster.
- Group names/rosters — owner-scoped reads; never cross the wire to non-members.
- SSE nudge / sync deltas — owner-scoped (`ownerId === session.user.id`); no cross-user subscribe.
- Gate logic — `canReadPost` and all four WHERE-builders agree; empty-`friendIds` is a never-match; revocation per-request.
- Mobile offline mirror — structurally safe: it only ever stores the owner's own posts.

## Method

Four parallel read-only audit lanes (post/comment read paths; private streaming +
cross-tenant; identity/relationship metadata; gate-logic correctness + mobile mirror), each
tracing read paths against the model and reporting `file:line` evidence. The two
higher-severity findings were independently re-verified against source before fixing.
