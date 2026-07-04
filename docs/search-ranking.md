# Search ranking — how `searchCorpus` works

This documents the implementation and the design principles behind curated search:
the `searchVector` full-text column, the embedding leg, how the two are fused, and
the human-relevance invariants the test suite enforces. Code lives in
`packages/db/src/search.ts` (the core), `packages/db/src/embed-client.ts` (embeddings),
and migration `20260624130000_weighted_search_vector` (the weighted FTS column).

## The shape: two legs fused by Reciprocal Rank Fusion

`searchCorpus(viewerId, query, opts)` is the single search entry point — shared by
`apps/web` (`/api/app/search`, catalog) and the MCP server, so UI and MCP can never
drift. It runs two independent ranked retrievals over the **same** viewer-visible
candidate set and fuses them:

1. **Full-text leg** — Postgres `tsvector` + `ts_rank` over `Post.searchVector`.
2. **Embedding leg** — brute-force cosine over the viewer's `PostEmbedding` vectors.

Each leg returns a ranked list of slugs. **Reciprocal Rank Fusion (RRF)** combines
them: a slug at rank *i* in a list contributes `1 / (k + i)` to its fused score
(`k = 60`, the canonical default). A slug present in **both** legs accumulates both
contributions *and* collects both `matchReasons` (`exact` from FTS, `similar` from
embeddings), so it naturally outranks single-leg hits — see "Why both-legs wins"
below. The fused list is then visibility-hydrated and paged.

When the embedding call fails (Gemini down / no key), the embedding leg returns
`null` and search degrades to **FTS-only** with `partial: true` — never an error.

## The full-text leg: a field-weighted, trigger-maintained `searchVector`

### Principle — what a user expects

Relevance should mirror how people remember content. A query word in the **title**
is a stronger signal than the same word buried in the body, because titles are
deliberate and memorable. Curated **tags/categories** are also high-precision
signals (a human chose them). An authored **excerpt** is a summary. The raw
**body** is bulk text. So the intended ranking strength is:

> **title > tags/categories > excerpt > body**

### Implementation — `setweight` + weighted `ts_rank`

`Post.searchVector` is a `tsvector` whose lexemes carry Postgres weight labels:

| Field | Weight label | `ts_rank` weight |
|-------|--------------|------------------|
| `title` | `A` | 1.0 |
| linked tag + category names | `B` | 0.4 |
| `excerpt` | `C` | 0.2 |
| `content` (body) | `D` | 0.1 |

The full-text leg ranks with `ts_rank('{0.1,0.2,0.4,1.0}', "searchVector", query)`
— the array is in `{D,C,B,A}` order. Because the lexemes are labeled, a title hit
scores 10× a body hit, a tag hit 4×, and so on. (Before this change `searchVector`
was an unweighted concatenation, so a title hit and a body hit ranked identically —
that was the bug this fixed.)

### Why a trigger, not a `GENERATED` column

Tags and categories live in the implicit many-to-many join tables `_PostToTag`
(`"A"`=Post, `"B"`=Tag) and `_PostToCategory` (`"A"`=Category, `"B"`=Post). A
Postgres `GENERATED ALWAYS ... STORED` column can only reference **same-row**
columns, so it cannot reach linked tag/category names. The migration therefore
makes `searchVector` a plain column maintained by triggers:

- `post_search_vector(id, title, excerpt, content)` — a `STABLE` function that
  builds the weighted vector, subquerying the join tables for tag/category names.
- A **BEFORE INSERT/UPDATE OF title, excerpt, content** trigger on `Post` recomputes
  the vector from the new row values.
- **AFTER INSERT/DELETE** triggers on `_PostToTag` and `_PostToCategory` recompute
  the affected post when its tag/category links change.

No recursion: the linkage triggers `UPDATE` only `searchVector`, which is **not** in
the BEFORE trigger's `OF (title, excerpt, content)` column list, so that trigger
does not re-fire. For the worker's real write path (`apps/worker` `post-writer.ts`
upserts a post with nested `connectOrCreate` tags/categories), the parent INSERT
fires the BEFORE trigger first (text-only), then the join-table INSERTs fire the
linkage triggers — all in one transaction, so the committed vector is complete.

### Query operators (free, via `websearch_to_tsquery`)

The leg parses queries with `websearch_to_tsquery('english', q)`, which never throws
on bad input and gives users Google-style operators:

- **Space = AND** — `rust gardening` requires both terms. (To rank "more terms
  matched higher" you need `rust OR gardening`, since AND excludes partial matches.)
- **Quotes = phrase** — `"quokka networking"` matches only adjacent terms.
- **`-` = negation** — `zephyrium -draft` excludes posts containing "draft".
- **Case-insensitive** — `to_tsvector` lowercases, so `ZEPHYRIUM` == `zephyrium`.

Ties (equal `ts_rank`) break by `createdAt DESC` — newest first — for deterministic
ordering.

## The embedding leg

`embed-client.ts` is the single embedding contract, shared with the worker so query
and document vectors live in the same space (`gemini-embedding-2`, 768 dims). The
query side is prefixed for asymmetric retrieval (`queryPrefix`); documents are
embedded at ingest into `PostEmbedding`. The leg embeds the query, computes cosine
similarity against the viewer-visible candidate vectors (`rankByCosine`, a pure
function), and returns the top slugs. v1 is brute-force in memory — fine for a
viewer's reachable corpus (hundreds to low-thousands); the upgrade path is pgvector
+ HNSW behind `listVisiblePostEmbeddings`, no signature change.

## Why both-legs wins (the RRF guarantee)

A both-legs hit's fused score is `1/(k+i_ft) + 1/(k+i_sem)`; a single-leg hit's is
one such term. With the per-leg candidate cap of 50 (max rank 49) and `k=60`, the
**minimum** two-term score (`1/109 + 1/109 ≈ 0.0184`) exceeds the **maximum**
one-term score (`1/60 ≈ 0.0167`). So a post matched by both FTS and embeddings
**always** outranks a post matched by only one — independent of the embedding
semantics. This is the `exact`+`similar` badge behavior users see.

## Visibility (defense in depth)

Both legs are gated by the same predicate (`searchVisibilityWhere`): the viewer's
own posts (any status) OR friends' `FRIENDS`/`GROUP` published posts OR `PUBLIC`
published posts. The two legs share the predicate so they never disagree about
what's reachable, and the final hydration re-applies it so a slug the viewer can't
actually read is dropped even if it leaked into a leg.

### The three scopes

`searchCorpus(viewerId, query, { scope })` takes `scope: "all" | "mine" | "friends"`:

| Scope | Own (any status) | Friends' FRIENDS/GROUP (published) | Friends' PUBLIC (published) | Any-author PUBLIC (published) |
|---|---|---|---|---|
| `mine` | ✅ | — | — | — |
| `all` | ✅ | ✅ | ✅ (via the global arm) | ✅ **only if `publicCatalogEnabled`** |
| `friends` | ✅ | ✅ | ✅ **(friend-author-gated)** | ❌ **never** |

There are **two distinct PUBLIC arms**, and keeping them separate is the security
crux of `scope=friends`:

- **Global unrestricted PUBLIC** (`includePublic`) — any author's published PUBLIC
  post. On **only** under `scope=all` AND when `publicCatalogEnabled` is true (the
  same kill-switch `canReadPost` honors). Off under `mine` and `friends`.
- **Friend-scoped PUBLIC** (`includeFriendPublic`) — a friend's published PUBLIC
  post, gated by `submittedById IN friendIds` (the same author gate as the
  FRIENDS/GROUP arms). Used **only** by `scope=friends`.

**The hard `scope=friends` guarantee:** there is **no PUBLIC arm without an
`IN friendIds` author gate**, and this holds **independently of
`publicCatalogEnabled`**. A friend's PUBLIC post is admitted because the author is a
friend (not because the public catalog is on); a non-friend's PUBLIC post is **never**
admitted under this scope, even when the flag is true. With **zero** friends the
friend arms contribute nothing, so the predicate degrades to own-posts-only — never
to "everything" (an empty arm set falls back to the `__none__` sentinel, matching
`posts.visibilityWhereForViewer`).

### The four mirrors (must stay in lockstep)

The identical friend-scoped predicate is expressed in **four** places; a divergence
between any of them is a visibility leak, so the test suite verifies all four agree:

1. `searchVisibilityWhere` (Prisma) — the hydration gate + shared shape.
2. `fullTextLeg` raw SQL — the friend-scoped PUBLIC arm carries the same
   `= ANY(friendIds)` author gate as FRIENDS/GROUP. Every interpolation is a plain
   value/array/boolean param (never a composed `Prisma.sql` fragment) — see the
   raw-SQL comment for why fragments break under the Next/Turbopack runtime.
3. `listVisiblePostEmbeddings` (the embedding leg's candidate set).
4. The final hydration gate (reuses `searchVisibilityWhere`).

`scope=friends` resolves `friendIds` and `blockedIds` (like `scope=all`, unlike
`scope=mine`); the blocked-author clamp excludes a blocked user's posts from every
arm, so even a still-"friend" who is blocked is fully invisible.

## Pagination

The cursor is an opaque integer offset into the fused list. The fused ranking is
recomputed per call (cheap at this scale) over a stable ordering, so paging just
slices: page 1 ∪ page 2 equals the prefix of the full ordering, with no duplicates
or gaps.

## Relevance invariants (the principles, as enforced tests)

The test suite encodes the human-relevance expectations as rigid invariants. These
are the contract; the exact weight numbers are tunable, the invariants are not:

- **Field weight** — title hit > excerpt hit > body-only hit (otherwise-equal posts).
- **Tag/category searchable** — a tag/category match surfaces the post, scored
  between title and body.
- **More terms matched** ranks higher (under OR semantics).
- **Phrase proximity** beats scattered terms.
- **Both-legs > single-leg** (the RRF guarantee above).
- **Visibility never-leaks** — a post the viewer can't read never appears, regardless
  of match strength (security-critical).
- **Degraded mode** — embedder failure → FTS-only, `partial: true`, no crash.
- **Owner finds own drafts**; **empty/stop-word query → nothing, no throw**;
  **pagination stable**; **negation/case-insensitivity** behave as users expect.

## Determinism & how to run the tests

Search ranking is verified by a deterministic suite in `packages/db` (no network at
test time): real Gemini embeddings are **snapshotted once** to
`test/fixtures/search-embeddings.json` and replayed via an injected `QueryEmbedder`
seam; the full-text leg runs against a real ephemeral test Postgres.

```sh
bun run db:test:setup                 # once: create + migrate the test DB (idempotent)
bun --cwd=packages/db run test        # pure units only (RRF, visibility, cosine), no DB
bun --cwd=packages/db run test:search # pure + integration (golden matrix) against the test DB
```

Spec: `docs/superpowers/specs/2026-06-24-deterministic-search-testing-design.md`.
Plan: `docs/superpowers/plans/2026-06-24-deterministic-search-testing.md`.
