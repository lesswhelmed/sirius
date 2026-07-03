# CP6 — Search, catalog & explore

Retrieval surfaces: curated corpus search (web `/catalog` + mobile Catalog
tab), and the Observatory/Tree embedding scene. The single search core is
`searchCorpus` in `packages/db/src/search.ts` (Postgres FTS + embedding
cosine, fused via RRF); ranking spec + the deterministic test harness are in
[`docs/search-ranking.md`](../search-ranking.md).

**Run the automated suite first** — `packages/db`: `bun run db:test:setup`
then `test:search`. The scenarios below cover what the harness can't: the
HTTP layer, both UIs, visibility gating with live sessions, and degraded mode.

> Last full pass: ⏳

**Shared anchors:** `packages/db/src/search.ts`,
`apps/web/app/api/app/search/route.ts`,
`apps/web/app/(public)/catalog/` (`curated-search.tsx`),
`apps/mobile/src/components/corpus-search.tsx`

---

### SRCH-1 · Curated search happy path, web + mobile parity  `P0` ⏳

**Preconditions:** an account with ≥10 completed posts whose embeddings exist
(`q "select count(*) from \"PostEmbedding\""` > 0).

**Steps:**
1. Web `/catalog`: search an exact title word; then search a paraphrase of a
   post's topic (no shared keywords).
2. Repeat both queries in the mobile Catalog tab search.
3. Exercise `scope=mine` vs `scope=all`, and page with the cursor.

**Expected:**
- Exact-word query: hit carries the `exact` match badge; paraphrase query:
  the intended post surfaces via the embedding leg with `similar`.
- Web and mobile return the same hits for the same query/scope (same
  `GET /api/app/search?q=&scope=&cursor=`).
- Pagination via cursor never repeats or skips hits.

---

### SRCH-2 · Search respects visibility & blocks  `P0` ⏳

The FTS and embedding legs share `searchVisibilityWhere`, and
`blockedAuthorExclusion()` is ANDed in — verify they can't disagree.

**Steps:** with the [VIS-2](CP4-friends-visibility.md) matrix in place, as B
search for distinctive words from each of A's four posts; repeat after
blocking A ([MOD-2](CP5-moderation-safety.md)).

**Expected:** hits appear **only** for posts B could read directly
(FRIENDS/PUBLIC/B's-group); PRIVATE and other-group posts never surface from
either leg; after blocking, zero hits for A at all.

**Anchors:** + `packages/db/src/moderation.ts`

---

### SRCH-3 · Degraded mode when embeddings are down  `P0` ⏳

**Steps:** make the Gemini embed call fail (unset/break `GEMINI_API_KEY` for
the web app in a dev run) and search.

**Expected:** search still returns FTS results with `partial: true` — no 500,
no empty-state lie. UIs render the results (optionally with a degraded hint),
and restoring the key restores hybrid results.

---

### SRCH-4 · Observatory / Tree scene parity  `P1` ⏳

Both hosts consume `GET /api/app/embedding-scene` and shape it with
`@repo/embedding-scene` — they must agree.

**Preconditions:** owner account with embedded + categorized posts (the scene
is owner-scoped and empty otherwise).

**Steps:**
1. Web `/space`: confirm the 3D scene + taxonomy outline render; select a
   category node; open a post from the drill-in Index.
2. Mobile Explore tab (`siriusapp://tree`): find the **same** category in the
   outline; drill in.

**Expected:** identical category tree and identical post lists under the same
node on both hosts; drill-in posts open their detail screens; a brand-new
account shows a sane empty state on both (no crash, no infinite spinner).

**Anchors:** `apps/web/app/(app)/space/space-view.tsx`,
`apps/mobile/src/app/(tabs)/tree.tsx`, `packages/embedding-scene/`,
`apps/web/app/api/app/embedding-scene/route.ts`

---

### SRCH-5 · MCP corpus search parity  `P2` ⏳

The MCP `full_text_search` tool sits on the same `searchCorpus` core.

**Steps:** mint an API key for the test user; call the MCP server's search
tool with a SRCH-1 query; compare hits to the web results. Verify a key for
user B returns **only** B-visible content (tenant isolation).

**Anchors:** `apps/mcp/`, `packages/db/src/search.ts`
