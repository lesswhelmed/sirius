# Plan 010: Stop the search embedding leg from over-fetching `retrievalText`/`title`

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- packages/db/src/embeddings.ts packages/db/src/search.ts packages/db/src/index.ts`
> If any changed, compare the excerpts below first.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

Every semantic search calls `listVisiblePostEmbeddings`, which selects each
candidate's full `embedding` (768 floats) **plus `retrievalText` (a large text
column) and `post.title`** — but the search leg (`rankByCosine`) uses only `slug` +
`embedding`. So each search drags a large text column and title across the wire from
Postgres for every visible candidate and immediately discards them. This plan splits
the query so the search leg fetches only what it uses, cutting query I/O with **zero
ranking change** (it drops unused columns only).

> Scope note: the *unbounded candidate count* (no `take`) and the pgvector migration
> are the bigger scaling story (see Maintenance notes) but carry recall/ranking risk
> and are deliberately **out of scope** here — this plan is the safe, no-behavior-
> change slice.

## Current state

- `packages/db/src/embeddings.ts` — `listVisiblePostEmbeddings` (returns rows at
  lines ~291–305):

```ts
  const rows = await prisma.postEmbedding.findMany({
    where: { post: postWhere },
    select: {
      embedding: true,
      retrievalText: true,                        // <-- unused by search
      post: { select: { slug: true, title: true } },  // <-- title unused by search
    },
  });
  return rows.map((r) => ({
    embedding: r.embedding,
    retrievalText: r.retrievalText,
    slug: r.post.slug,
    title: r.post.title,
  }));
```

- `packages/db/src/search.ts` — the search leg uses only `slug` + `embedding`:

```ts
export function rankByCosine(
  queryVector: number[],
  candidates: { slug: string; embedding: number[] }[],
  limit: number,
): string[] { /* cosine, sort, slice, map to slugs */ }

async function semanticLeg(...) {
  // ...
  const candidates = await listVisiblePostEmbeddings(
    viewerId, friendIds, includePublic, blockedIds, includeOwn, includeFriendPublic,
  );
  return rankByCosine(queryVector, candidates, limit);
}
```

- **Other caller that DOES use `retrievalText` + `title`**: the reflection stage,
  `apps/worker/src/pipeline/reflection/generate.ts:209` calls
  `listVisiblePostEmbeddings(ownerId, [], false)` and reads `retrievalText`/`title`.
  So the existing fat function must stay for that caller — the fix is an **additive
  lean variant** for search, not a change to the existing function's shape.
- `packages/db/src/index.ts` re-exports the db helpers by name; a new exported
  function must be added there too if it isn't picked up by an `export *`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `bun run check-types` (run `bun run db:generate` first) | exit 0 |
| Lint | `bun --cwd packages/db run lint` (after plan 002) or `bun run lint` | exit 0 |
| Search unit tests | `bun --cwd packages/db test` (runs `src/search.test.ts`) | pass |
| Search full suite (needs test DB) | `bun run db:test:setup` then `bun --cwd packages/db run test:search` | pass |

## Scope

**In scope**:
- `packages/db/src/embeddings.ts` (add a lean `listVisiblePostEmbeddingVectors`
  selecting only `{ embedding, post: { slug } }`, sharing the same visibility+block
  `where` as the fat function — factor the `where`-builder if needed so the two can't
  diverge)
- `packages/db/src/search.ts` (`semanticLeg` calls the lean variant)
- `packages/db/src/index.ts` (export the new function if required)

**Out of scope**:
- The reflection caller and the fat `listVisiblePostEmbeddings` — leave both as-is.
- Adding a `take`/bound or pgvector — deliberately deferred (recall risk).
- The visibility/block `where` semantics — must stay identical (the two legs must
  never disagree about a blocked author; if you factor the `where`-builder, both the
  fat and lean functions must use it).

## Git workflow

- Branch: `advisor/010-search-overfetch`
- Commit explicit paths only. **Never `git add -A`.**
- Message: `perf(db): lean vector select for the search embedding leg`.

## Steps

### Step 1: Extract the shared visibility+block `where` (if not already isolated)

In `embeddings.ts`, the fat function builds a `postWhere` (visibility OR-arms +
`blockedAuthorExclusion`). Ensure that `where`-building is reusable — either it's
already a helper, or lift it into a small local function `buildVisibleEmbeddingWhere(...)`
that both the fat and the new lean function call. This guarantees the two never
diverge on visibility/block rules.

**Verify**: `bun run check-types` → exit 0.

### Step 2: Add the lean vector function

Add `listVisiblePostEmbeddingVectors(...)` with the SAME parameters as
`listVisiblePostEmbeddings`, using the shared `where`, but selecting only
`{ embedding: true, post: { select: { slug: true } } }` and returning
`{ slug: string; embedding: number[] }[]`. Export it from `index.ts` if needed.

**Verify**: `bun run check-types` → exit 0.

### Step 3: Point `semanticLeg` at the lean function

In `search.ts`, change `semanticLeg` to call `listVisiblePostEmbeddingVectors(...)`
instead of `listVisiblePostEmbeddings(...)`. `rankByCosine` already consumes only
`{ slug, embedding }`, so no other change is needed.

**Verify**: `bun run check-types` → exit 0.

### Step 4: Run the search tests

**Verify**: `bun --cwd packages/db test` → pass (unit). If a test DB is available:
`bun run db:test:setup` then `bun --cwd packages/db run test:search` → pass. Search
results/ranking must be **identical** to before (only dropped columns changed).

## Test plan

- The existing `packages/db/src/search.test.ts` + `search.integration.test.ts`
  (deterministic search harness, documented in `docs/search-ranking.md`) already
  cover ranking. This plan must not change their expected outputs — the fix is
  column-selection only.
- Add a focused unit assertion (in `search.test.ts` or a sibling) that `semanticLeg`
  / `rankByCosine` produce the same slug ordering as before given the same vectors —
  i.e. confirm the lean-vs-fat swap didn't alter ranking. If the harness already
  pins this, no new test is strictly required; note that in your report.
- Verification: `bun --cwd packages/db run test:search` → all pass, unchanged
  expectations.

## Done criteria

- [ ] A lean `listVisiblePostEmbeddingVectors` selects only `{ embedding, slug }`
- [ ] `semanticLeg` uses the lean function; `rankByCosine` unchanged
- [ ] The fat `listVisiblePostEmbeddings` and the reflection caller are untouched
- [ ] Both functions share one visibility+block `where`-builder (no divergence)
- [ ] `bun run check-types` exits 0
- [ ] `bun --cwd packages/db test` passes; search ranking output unchanged
- [ ] `git status` shows only the in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The visibility/block `where` cannot be cleanly shared between the two functions
  without risk of divergence — report; do NOT duplicate the `where` logic (that
  reintroduces the exact drift `blockedAuthorExclusion` was built to prevent).
- The search harness output changes after the swap — that means the fat function was
  doing something the lean one isn't; report the diff.
- `listVisiblePostEmbeddings` is used by another caller besides search + reflection
  that needs `retrievalText`/`title` — grep first (`grep -rn "listVisiblePostEmbeddings" apps packages`);
  report any additional caller.

## Maintenance notes

- **Deferred, higher-value follow-up (separate plan):** the candidate set is
  unbounded (no `take`) and cosine runs in JS; with `scope=all` + public catalog it
  scans the whole public corpus per query, and offset paging recomputes it per page.
  The real fix is pgvector (`vector(768)` + HNSW + SQL `<=>`) behind this same
  `listVisiblePostEmbeddingVectors` seam, or an interim bounded candidate set. Both
  change recall characteristics, so they need the search harness re-baselined — do
  them deliberately, not as a quick win. Revisit when any single viewer's reachable
  PUBLIC vector set crosses low thousands.
- The reflection stage (`generate.ts:209`) has the same all-vectors load; it can
  reuse the eventual bounded/pgvector nearest-N primitive.
- A reviewer should confirm the lean function's `where` is literally the shared
  builder, not a copy.
