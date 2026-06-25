# Curated Corpus Search — Design

**Date:** 2026-06-24
**Status:** Approved-for-implementation (decisions locked via brainstorming)

## Goal

Take what the MCP server's single query tools already do (full-text + embedding
retrieval over a user's corpus) and compose them into one **curated search**
experience the user drives from the UI. The user types a query; we run a
full-text "hard" search across all post bodies AND an embedding similarity
search, then fuse both into a single relevance-ranked result list. Surfaced on
**both web and mobile**, reusing existing building blocks.

## Locked decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Result presentation | **Blended ranked list** via Reciprocal Rank Fusion, each row tagged with match reasons (`exact` / `similar`) |
| Search scope | **Mine + friends + public** — visibility-gated (`canReadPost` semantics) |
| Surface | **Augment existing surfaces** — web `/catalog` + mobile library tab (search is a networked overlay; mobile's offline local-mirror browse is unchanged) |
| Architecture | **Approach A** — logic in `@repo/db`, one `/api/app/search` route, both clients call it, MCP refactored to reuse the shared core |
| Full-text | **Real Postgres FTS** — generated `tsvector` column over `title + excerpt + content` + GIN index, `ts_rank` for ranking |
| Embedding | **Brute-force cosine v1**, visibility-gated candidate set; pgvector `<=>` remains the documented upgrade path behind the same signature |
| Interaction | **Debounced live-as-you-type** search |
| UI tooling | **Stitch** for UX design → **v0** for the React search component → adapt to web + port to mobile |

## Architecture

### New shared core — `packages/db/src/search.ts`

Single entry point:

```ts
searchCorpus(viewerId: string, query: string, opts: SearchOpts): Promise<SearchPage>
```

It composes three internal steps:

1. `fullTextSearch(viewerId, query, opts)` — Postgres FTS over the new tsvector,
   visibility-gated, returns `{ slug, rank }[]` ordered by `ts_rank` desc.
2. `semanticSearch(viewerId, query, opts)` — `embedContent(queryPrefix(query))`
   then `cosineSimilarity` against the **visible** `PostEmbedding` candidate set
   (yours + friends' FRIENDS/PUBLIC + PUBLIC), returns `{ slug, score }[]`.
3. `reciprocalRankFusion(fullText, semantic)` — fuse both ranked lists:
   `score = Σ 1 / (k + rank_i)` with `k = 60`; attach
   `matchReasons: ('exact'|'similar')[]` per slug. Then hydrate to full post
   summaries via the existing `listPostsBySlugs`-style helper (order preserved
   by the fused rank).

`SearchHit` (the wire DTO) and the pure `reciprocalRankFusion` fn are exported
from `@repo/db` so the API route, both clients' types, and the MCP server share
one definition.

### Visibility gating

Both retrieval paths must respect the friends/visibility model rather than
owner-only:

- **FTS:** the candidate `WHERE` combines the tsvector match with the same
  visibility predicate used by `listVisibleToViewer` (owner OR PUBLIC OR
  (FRIENDS AND mutual-friend)).
- **Embedding:** the candidate `PostEmbedding` fetch is widened from owner-only
  to the viewer-visible set. New helper:
  `listVisiblePostEmbeddings(viewerId)` in `embeddings.ts`.

### API route — `apps/web/app/api/app/search/route.ts`

- Session-authed via `getSessionOrNull()`; `401` if absent.
- Params: `q` (required, trimmed; empty → empty page), `scope` (optional:
  `all` default | `mine`), `limit` (default 24, cap 50), `cursor`.
- Returns `{ items: SearchHit[], nextCursor: string | null }`.
- No route-segment config exports (Cache Components constraint).
- Errors: `400` empty/invalid query handled as empty result; `502` if the query
  embedding call fails BUT full-text still returns (degrade gracefully —
  surface FTS results with a `partial: true` flag rather than failing the whole
  search).

### MCP refactor

`apps/mcp/src/retrieval/keyword.ts` and `semantic.ts` are refactored to call the
shared `@repo/db` cores so the MCP tools and the UI never drift. Tool contracts
unchanged.

## UI

### Web — `/catalog`

Replace the bare `apps/web/app/(public)/catalog/search.tsx` input with the
v0-generated search component: debounced field, blended result rows with
`exact`/`similar` badges, loading + empty + partial states. Client component
calling `/api/app/search` (the catalog page itself stays owner/visibility
correct via the route).

### Mobile — library tab

Add a networked search overlay to `apps/mobile/src/app/(tabs)/library.tsx`:
debounced query → `useInfiniteQuery` against `/api/app/search` via `apiGet`,
rendered with the same blended-row + badge layout (ported from the v0 design to
RN). The existing local-mirror category/tag browse remains the default; search
is an online mode toggled when the field is focused/non-empty.

### Design pipeline

1. **Stitch** — generate the search UX (field, blended rows, reason badges,
   states), themed to the app's existing palette.
2. **v0** — generate the polished React component from the Stitch design.
3. **Adapt** — wire into web `/catalog`; port the layout/interaction to RN for
   the mobile library tab.

## Data model change

Migration (hand-authored SQL, `migrate deploy`, plain GIN index — no
`CONCURRENTLY`, per Prisma-7 raw-SQL gotchas):

- Add generated column `Post.searchVector tsvector` =
  `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(content,''))`.
- `CREATE INDEX post_search_vector_idx ON "Post" USING GIN ("searchVector")`.
- Prisma schema: add `searchVector Unsupported("tsvector")?` + `@@index(..., type: Gin)`
  annotation (or map the raw index) so generate doesn't drift.

## Testing / verification

No test runner is wired in this repo. Verification is manual against real data:
run the dev stack, search a known query, confirm (a) body-only matches surface
(proves FTS over `content`), (b) semantically-related-but-non-matching posts
surface (proves embedding leg), (c) a friend's PUBLIC post surfaces under
`scope=all` but not `scope=mine` (proves visibility gating), (d) badges reflect
the right legs. Plus the MCP tools still return correct results after the
refactor.

## Out of scope (v1)

- pgvector / HNSW (documented upgrade path, same signatures).
- On-device/offline search in the mobile local mirror (search is online-only).
- Cross-corpus public discovery beyond the existing visibility model.
