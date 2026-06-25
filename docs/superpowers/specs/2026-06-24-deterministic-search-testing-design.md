# Deterministic Search Testing + Relevance Invariants — Design

**Date:** 2026-06-24
**Status:** Approved (design) — pending spec review → implementation plan
**Owner role:** Orchestrator (design, procedure gates, final E2E validation). Implementation
delegated to subagents.

## Problem & motivation

Curated search (`packages/db/src/search.ts` → `searchCorpus`) is one of the most critical
features. It fuses a Postgres full-text leg (`tsvector` + `ts_rank`) with a Gemini-embedding
semantic leg via Reciprocal Rank Fusion (RRF). It currently has **no automated tests**, and
two properties block deterministic testing:

1. **The FTS leg is Postgres-native.** `ts_rank` ordering cannot be faithfully reproduced
   with mocks — testing it requires a real Postgres.
2. **The semantic leg calls Gemini live** — network-dependent, non-deterministic, and subject
   to model drift.

A relevance audit during design also found that **ranking does not meet basic human
expectations**: `searchVector` is built by plain concatenation with **no `setweight`**
(migration `20260624120000`), so `ts_rank` scores a title hit identically to a body hit, and
**tags/categories are not searchable at all**. We want the test suite to encode realistic user
expectations as *rigid* invariants and to drive the ranking fixes those invariants expose
(TDD: write the expectation, watch it fail, fix until green).

## Goals

- A **deterministic** golden data set (fixture corpus + query→expected-results matrix) that
  exercises happy paths and edge cases, with no network at test time.
- A catalog of **human-expectation relevance invariants** asserted rigidly.
- The ranking fixes those invariants require: **field-weighted** `searchVector` (title >
  curated labels > excerpt > body) and **tags/categories as searchable, scored signals**.
- A real **test-Postgres integration harness** plus exhaustive **pure-unit** tests for the
  already-pure pieces.
- **E2E validation gate:** the full suite runs green against a real test DB with snapshotted
  embeddings before "done" — no scaffolding-only acceptance.

## Non-goals

- Replacing the brute-force in-memory cosine semantic leg with pgvector (separate, deferred).
- A live-Gemini smoke test of real semantic quality (may exist separately; not this work).
- Tuning RRF constants beyond what invariants demand.

## Decisions (locked during brainstorming)

1. **Test layer:** Hybrid — pure units for `reciprocalRankFusion` + `searchVisibilityWhere`,
   plus an integration suite running real `searchCorpus` against an ephemeral test Postgres
   with embeddings injected via a new seam.
2. **Embedding determinism:** Snapshot real Gemini embeddings to JSON fixtures once
   (regeneration script), replay deterministically at test time. No Gemini in CI.
3. **Ranking fix in scope:** TDD the fixes the invariants expose (weighted `searchVector` +
   `ts_rank` weights; tags/categories searchable).
4. **Assertion strictness:** Layered — Tier 1 invariants (relational), Tier 2 ordered-subset,
   Tier 3 exact snapshots for a few canonical queries only.
5. **Tags/categories:** searchable and scored now, placed appropriately in the point-based
   weight hierarchy.

## Architecture — production code changes

These are the only changes to shipping code; both are behavior-preserving except the ranking
improvement, which is intentional and validated by invariants.

### A. Embedder seam in `searchCorpus`

`semanticLeg` currently imports `embedContent` directly from `./embed-client`. Add an optional
injected embedder:

- `searchCorpus(viewerId, query, opts)` gains `opts.embedder?: (text: string) => Promise<number[]>`,
  defaulting to the real `embedContent`-backed implementation (with the existing `queryPrefix`).
- Tests inject a **fixture-backed embedder** that maps known query text → its snapshot vector.
- Production path is unchanged when `embedder` is omitted.

The semantic leg's *document* vectors come from `listVisiblePostEmbeddings` (the `PostEmbedding`
table). The harness seeds those rows from the same snapshot, so query and document vectors live
in one consistent space — deterministic end to end.

### B. Field-weighted, trigger-maintained `searchVector` (the ranking fix)

The current `GENERATED ALWAYS AS STORED` column cannot include tags/categories (they live in
join tables `_PostToTag` / `_PostToCategory`; a generated column can only reference same-row
columns). Replace it with a **trigger-maintained** weighted tsvector via a new migration:

- Convert `searchVector` to a plain `tsvector` column (keep the GIN index; Prisma keeps
  `Unsupported("tsvector")?` — trigger logic lives in raw SQL).
- A trigger function recomputes `searchVector` on Post INSERT/UPDATE using `setweight`:

  | Field | Weight | Rationale |
  |-------|--------|-----------|
  | `title` | **A** (1.0) | Most memorable / direct — the strongest human signal |
  | `tags` + `categories` (names) | **B** (0.4) | Curated, deliberate, high-precision labels |
  | `excerpt` | **C** (0.2) | Authored summary |
  | `content` (body) | **D** (0.1) | Bulk text |

  > These weights are the **starting hypothesis**; Tier-1 invariants validate and tune them.
  > The default `ts_rank` weight vector is `{D,C,B,A} = {0.1,0.2,0.4,1.0}`.

- Tag/category contribution is computed in the trigger via subqueries joining `_PostToTag` →
  `Tag.name` and `_PostToCategory` → `Category.name`/`displayName`.
- **Linkage triggers:** INSERT/DELETE on `_PostToTag` and `_PostToCategory` recompute the
  affected post(s)' `searchVector`, so tag/category edits stay reflected.
- The migration **backfills** all existing rows.
- `fullTextLeg` passes the weight array to `ts_rank`:
  `ts_rank('{0.1,0.2,0.4,1.0}', p."searchVector", websearch_to_tsquery('english', $query))`.

> **Alternative considered & rejected:** denormalized `tagText`/`categoryText` columns kept in
> sync by `post-writer.ts` + a generated column. Rejected because it leaks search concerns into
> the writer and drifts if tags are edited elsewhere. The DB-side trigger is correct regardless
> of who writes.

## The deterministic data set

### Fixture corpus (~18–24 posts, hand-authored)

Authored across **3 users** to exercise visibility:

- `viewer` — the searching user.
- `friend` — a mutual friend of `viewer`.
- `stranger` — no relationship.

Controlled axes (each probe term placed deliberately):

- Same probe term appearing **title-only** vs **excerpt-only** vs **body-only** vs **tag/category-only**
  (the I1/tags invariants hinge on these matched pairs).
- **Common** term (many posts) vs **rare/discriminating** term.
- **Long** vs **short** bodies (ts_rank density normalization).
- **Near-duplicates** differing only by `createdAt` (recency tiebreak).
- Multiple `type` (BLOG/FINDING/SIGHT), categories, tags.
- Visibility/status grid: PRIVATE/FRIENDS/PUBLIC × DRAFT/PUBLISHED across the 3 users.
- Stop-word-only and punctuation/unicode probe content (edge cases).

### Embeddings — snapshot fixtures

- Script: `packages/db/scripts/snapshot-search-fixtures.ts` (run manually; requires
  `GEMINI_API_KEY`). Embeds **every fixture post** (document vectors) and **every golden query**
  (query vectors) once via the real `embed-client`, writes JSON to
  `packages/db/test/fixtures/search-embeddings.json`.
- Committed to git. The only time Gemini is touched. Regen is explicit + documented.
- Harness seeds `PostEmbedding` rows from doc vectors; the fixture-backed embedder returns query
  vectors by exact query text.

### Query → expected-results matrix

A declarative table co-located with the corpus (`packages/db/test/fixtures/search-corpus.ts`)
of `{ query, scope, viewerKey, expectations }`, where `expectations` mixes the three assertion
tiers. The dataset reads as one spec.

## Assertion model (layered)

### Tier 1 — Relevance invariants (relational, robust)

| ID | Invariant |
|----|-----------|
| I1 | Field weight: title-match ranks above excerpt-match above body-only-match (otherwise equal posts). |
| I2 | A post containing the literal term ranks above a semantically-related post lacking it. |
| I3 | Both-legs hit (`exact`+`similar`) ranks above a single-leg hit. |
| I4 | More query terms matched ranks above fewer. |
| I5 | Quoted-phrase query: contiguous-phrase post ranks above scattered-terms post. |
| I6 | Equal rank → newer `createdAt` first (deterministic tiebreak). |
| I7 | **Visibility never-leak (security-critical):** a post the viewer cannot read NEVER appears, regardless of match strength — across scope=all/mine, friend/stranger, PRIVATE/FRIENDS/PUBLIC, DRAFT/PUBLISHED. |
| I8 | Empty / stop-word-only query → empty result, no throw. |
| I9 | Degraded mode: embedder failure → FTS-only, `partial: true`, no crash, exact matches still present and ordered. |
| I10 | Owner finds own DRAFT/unpublished posts (scope=mine and scope=all). |
| I11 | Tag/category match: a query matching a post's tag or category name surfaces that post, scored at weight B (above body-only, below title). |
| I12 | Pagination is stable: page1 ∪ page2 = full ordering, no duplicates, no gaps. |

### Tier 2 — Ordered-subset
For each golden query: "these slugs appear in this relative order" (tolerant of new fixtures).

### Tier 3 — Exact snapshot
Full ordered slug list for ~2–3 canonical queries only (brittleness contained).

## Test layout & harness

- **Pure units** → `packages/db/src/search.test.ts` (`bun:test`, no I/O): exhaustive
  `reciprocalRankFusion` (both-legs accumulation, reason merge, ordering, RRF math) and
  `searchVisibilityWhere` (every OR branch, empty friends, includePublic toggle).
- **Integration** → `packages/db/src/search.integration.test.ts`: against `TEST_DATABASE_URL`,
  runs `prisma migrate deploy`, truncates + seeds the golden corpus & snapshot embeddings, runs
  real `searchCorpus`, asserts all three tiers, tears down. **Skips cleanly** (logged) when
  `TEST_DATABASE_URL` is unset so contributors without Postgres aren't blocked — but CI and the
  orchestrator run it for real.
- Wire a real `test` script: `bun test` per package; ensure `turbo run test` resolves to the
  actual suites in `@repo/db`.

## Orchestration & delegation (work packages)

The orchestrator authors spec + plan, then delegates discrete packages to subagents and enforces
the verification gates:

- **WP1** — Fixture corpus + query/expected matrix authoring.
- **WP2** — Snapshot regeneration script + committed embedding fixtures.
- **WP3** — Test-DB harness (migrate/seed/truncate/teardown + skip gate) and embedder seam.
- **WP4** — Pure-unit tests (RRF + visibility).
- **WP5** — Ranking fix: weighted trigger-maintained `searchVector` migration + `ts_rank`
  weights + linkage triggers + backfill.
- **WP6** — Integration tests asserting all three tiers; TDD-drive WP5 to green.

### Procedure gates (enforced by orchestrator)
1. Invariant tests written **before** WP5; the title>body and tag/category invariants must be
   observed **failing** first.
2. WP5 lands; invariants flip to green.
3. **Final E2E gate:** full pure + integration suite green against a real test Postgres with
   snapshot embeddings. Real pass/fail on the real surface — no scaffolding-only acceptance.

## Risks / open items

- **Trigger correctness on bulk ops:** ensure the linkage triggers handle batch tag/category
  connects (the worker `connectOrCreate`s); migration backfill must cover all existing rows.
- **Snapshot staleness:** an embedding-model/dim change invalidates fixtures; the regen script
  is the documented remedy (determinism is intentionally decoupled from live model drift).
- **Weight tuning:** the A/B/C/D mapping is a hypothesis; invariants may push specific weights.
  Treat the weight vector as tunable, the invariants as fixed intent.
