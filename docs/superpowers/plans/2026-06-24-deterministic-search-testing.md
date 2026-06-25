# Deterministic Search Testing + Relevance Invariants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, embedding-aware test suite for `searchCorpus` that encodes human relevance expectations as rigid invariants, and fix the ranking those invariants expose (field-weighted + tag/category-aware search).

**Architecture:** Pure-unit tests (`bun:test`) for the already-pure fusion/visibility code; an integration suite that runs the real `searchCorpus` against an ephemeral test Postgres seeded with a hand-authored fixture corpus and *snapshotted* Gemini embeddings (replayed via an injected embedder seam — no network at test time). The suite is TDD-ordered: the title>body and tag/category invariants are observed failing, then a weighted, trigger-maintained `searchVector` migration makes them green.

**Tech Stack:** TypeScript, `bun:test`, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL full-text (`tsvector`/`ts_rank`/`websearch_to_tsquery`), Gemini `gemini-embedding-2` (snapshot only).

## Global Constraints

- Package manager is **bun**; run package scripts, never invent new dev servers.
- Tests use **`bun:test`** (`import { test, expect, describe, beforeAll, afterAll } from "bun:test"`). No vitest/jest.
- Prisma client reads `process.env.DATABASE_URL` **at construction time** (`packages/db/src/index.ts:93`). The integration suite must be run with `DATABASE_URL` already pointed at the test DB.
- Generated Prisma client is gitignored — `bun run db:generate` must have been run.
- Embedding space: `gemini-embedding-2`, dimensionality **768** (`packages/db/src/embed-client.ts`).
- `PostEmbedding.embedding` is a Postgres `Float[]` (`number[]` in TS).
- Implicit m2m join-table FK mapping (VERIFIED): `_PostToTag` → `"A"`=Post.id, `"B"`=Tag.id; `_PostToCategory` → `"A"`=Category.id, `"B"`=Post.id.
- `ts_rank` weight-array order is `{D,C,B,A}`.
- Never `git add -A` (repo runs a multi-agent swarm on `main`); stage explicit paths only.
- Commit message footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `packages/db/src/search.ts` — **modify**: extract pure `rankByCosine`, add `QueryEmbedder` seam.
- `packages/db/src/search.test.ts` — **create**: pure units (RRF, visibility predicate, rankByCosine).
- `packages/db/test/fixtures/search-corpus.ts` — **create**: fixture users/posts/tags/categories + query→expected matrix.
- `packages/db/test/fixtures/search-embeddings.json` — **create (generated)**: snapshot vectors keyed by slug + query text.
- `packages/db/scripts/snapshot-search-fixtures.ts` — **create**: regenerates the embedding fixture via real Gemini.
- `packages/db/test/search-harness.ts` — **create**: seed/truncate/teardown + fixture-backed embedder + run gate.
- `packages/db/src/search.integration.test.ts` — **create**: Tier 1/2/3 assertions through real `searchCorpus`.
- `packages/db/prisma/migrations/20260624130000_weighted_search_vector/migration.sql` — **create**: weighted, trigger-maintained `searchVector`.
- `packages/db/package.json` — **modify**: add `test` + `test:search` scripts.

---

## Task 1: Pure-unit tests for `reciprocalRankFusion`

**Files:**
- Test: `packages/db/src/search.test.ts`

**Interfaces:**
- Consumes: `reciprocalRankFusion(fullText: string[], semantic: string[]): { slug: string; score: number; matchReasons: ("exact"|"similar")[] }[]` (already exported from `search.ts`).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/search.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { reciprocalRankFusion, searchVisibilityWhere } from "./search";

describe("reciprocalRankFusion", () => {
  test("a slug in BOTH legs outranks single-leg slugs and merges both reasons", () => {
    const fused = reciprocalRankFusion(["a", "b"], ["b", "c"]);
    const b = fused.find((r) => r.slug === "b")!;
    expect(b.matchReasons).toEqual(["exact", "similar"]);
    // b accumulates 1/(60+1) (ft rank 1) + 1/(60+0) (sem rank 0); a and c get one leg each.
    expect(fused[0].slug).toBe("b");
    expect(b.score).toBeGreaterThan(fused.find((r) => r.slug === "a")!.score);
    expect(b.score).toBeGreaterThan(fused.find((r) => r.slug === "c")!.score);
  });

  test("preserves intra-leg order via 1/(k+rank) and tags single-leg reasons", () => {
    const fused = reciprocalRankFusion(["x", "y", "z"], []);
    expect(fused.map((r) => r.slug)).toEqual(["x", "y", "z"]);
    expect(fused.every((r) => r.matchReasons.length === 1 && r.matchReasons[0] === "exact")).toBe(true);
  });

  test("empty inputs yield empty output", () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (these assert existing correct behavior)**

Run: `cd packages/db && bun test src/search.test.ts`
Expected: PASS (3 tests). `reciprocalRankFusion` already behaves correctly; this locks it in.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/search.test.ts
git commit -m "test(search): pure unit tests for reciprocalRankFusion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pure-unit tests for `searchVisibilityWhere`

**Files:**
- Test: `packages/db/src/search.test.ts` (append)

**Interfaces:**
- Consumes: `searchVisibilityWhere(viewerId: string, friendIds: string[], includePublic: boolean): Prisma.PostWhereInput` (exported).

- [ ] **Step 1: Write the failing test (append to the file)**

```ts
describe("searchVisibilityWhere", () => {
  test("viewer-only when no friends and public excluded", () => {
    const w = searchVisibilityWhere("u1", [], false);
    expect(w.OR).toEqual([{ submittedById: "u1" }]);
  });

  test("adds friends' published FRIENDS clause when friends present", () => {
    const w = searchVisibilityWhere("u1", ["f1", "f2"], false);
    expect(w.OR).toContainEqual({
      submittedById: { in: ["f1", "f2"] },
      visibility: "FRIENDS",
      status: "PUBLISHED",
    });
    expect(w.OR).not.toContainEqual({ visibility: "PUBLIC", status: "PUBLISHED" });
  });

  test("adds PUBLIC published clause when includePublic", () => {
    const w = searchVisibilityWhere("u1", [], true);
    expect(w.OR).toContainEqual({ visibility: "PUBLIC", status: "PUBLISHED" });
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd packages/db && bun test src/search.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/search.test.ts
git commit -m "test(search): pure unit tests for searchVisibilityWhere

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extract pure `rankByCosine` + add `QueryEmbedder` seam

**Files:**
- Modify: `packages/db/src/search.ts`
- Test: `packages/db/src/search.test.ts` (append)

**Interfaces:**
- Produces: `export function rankByCosine(queryVector: number[], candidates: { slug: string; embedding: number[] }[], limit: number): string[]`
- Produces: `export type QueryEmbedder = (query: string) => Promise<number[]>`
- Produces: `searchCorpus(viewerId, query, opts)` where `opts` gains `embedder?: QueryEmbedder` (defaults to the real Gemini-backed embedder). Behavior unchanged when omitted.

- [ ] **Step 1: Write the failing test (append)**

```ts
import { rankByCosine } from "./search";

describe("rankByCosine", () => {
  const cands = [
    { slug: "near", embedding: [0.99, 0.01, 0, 0] },
    { slug: "far", embedding: [0, 1, 0, 0] },
    { slug: "mid", embedding: [0.7, 0.7, 0, 0] },
  ];
  test("orders candidates by cosine similarity to the query vector, desc", () => {
    expect(rankByCosine([1, 0, 0, 0], cands, 10)).toEqual(["near", "mid", "far"]);
  });
  test("honors the limit", () => {
    expect(rankByCosine([1, 0, 0, 0], cands, 1)).toEqual(["near"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && bun test src/search.test.ts`
Expected: FAIL — `rankByCosine` is not exported yet.

- [ ] **Step 3: Refactor `search.ts`**

In `packages/db/src/search.ts`, add the pure helper and the seam. Add after the `reciprocalRankFusion` function:

```ts
export type QueryEmbedder = (query: string) => Promise<number[]>;

// Default seam: embed the query in the worker's space (asymmetric query prefix).
const defaultQueryEmbedder: QueryEmbedder = (q) =>
  embedContent([{ text: queryPrefix(q) }]);

// Pure cosine ranking — extracted from semanticLeg so it can be unit-tested
// without a DB or a live embedder.
export function rankByCosine(
  queryVector: number[],
  candidates: { slug: string; embedding: number[] }[],
  limit: number,
): string[] {
  return candidates
    .map((c) => ({ slug: c.slug, score: cosineSimilarity(queryVector, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.slug);
}
```

Replace the body of `semanticLeg` so it takes an embedder and uses `rankByCosine`:

```ts
async function semanticLeg(
  viewerId: string,
  query: string,
  friendIds: string[],
  includePublic: boolean,
  limit: number,
  embedder: QueryEmbedder,
): Promise<string[] | null> {
  let queryVector: number[];
  try {
    queryVector = await embedder(query);
  } catch {
    return null;
  }
  const candidates = await listVisiblePostEmbeddings(
    viewerId,
    friendIds,
    includePublic,
  );
  return rankByCosine(queryVector, candidates, limit);
}
```

In `searchCorpus`, widen the opts type and thread the embedder through:

```ts
export async function searchCorpus(
  viewerId: string,
  query: string,
  opts: {
    scope?: "all" | "mine";
    limit?: number;
    cursor?: string;
    embedder?: QueryEmbedder;
  } = {},
): Promise<SearchPage> {
```

And at the `Promise.all` call site:

```ts
  const embedder = opts.embedder ?? defaultQueryEmbedder;
  const [ftSlugs, semSlugs] = await Promise.all([
    fullTextLeg(viewerId, q, friendIds, includePublic, FUSION_CANDIDATES),
    semanticLeg(viewerId, q, friendIds, includePublic, FUSION_CANDIDATES, embedder),
  ]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && bun test src/search.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Verify no type regressions**

Run: `cd packages/db && bun run check-types`
Expected: no errors. (Callers in `apps/web` pass no `embedder`, so they keep the default.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/search.ts packages/db/src/search.test.ts
git commit -m "refactor(search): extract pure rankByCosine + add QueryEmbedder seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Fixture corpus + query→expected matrix

**Files:**
- Create: `packages/db/test/fixtures/search-corpus.ts`

**Interfaces:**
- Produces: `FIXTURE_USERS`, `FIXTURE_TAGS`, `FIXTURE_CATEGORIES`, `FIXTURE_POSTS`, `GOLDEN_QUERIES`, and the types `FixturePost`, `GoldenQuery`.

The corpus deliberately plants the same probe terms across title/excerpt/body/tag/category and across users/visibility to exercise every invariant. **`createdAt` is set so that, BEFORE the ranking fix, field-weight invariants fail** (the body-only post is newer, so the recency tiebreak ranks it first until weights differentiate).

- [ ] **Step 1: Create the fixture module**

```ts
// Deterministic search fixtures. Slugs are stable keys joining posts to their
// snapshot embedding vectors (search-embeddings.json). Probe terms are nonsense
// words ("zephyrium", "quokkanet") so they never collide with English stemming.
export type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC";
export type Status = "DRAFT" | "PUBLISHED";

export interface FixtureUser {
  key: "viewer" | "friend" | "stranger";
  id: string;
  name: string;
  email: string;
  handle: string;
}

export interface FixturePost {
  slug: string;
  ownerKey: FixtureUser["key"];
  title: string;
  excerpt: string | null;
  content: string;
  type: "BLOG" | "FINDING" | "SIGHT";
  status: Status;
  visibility: Visibility;
  tags: string[]; // Tag.name values
  categories: string[]; // Category.name values
  createdAtIso: string;
}

export type AssertMode = "fts-only" | "fused";

export interface GoldenQuery {
  name: string;
  query: string;
  viewerKey: FixtureUser["key"];
  scope: "all" | "mine";
  mode: AssertMode; // fts-only => harness injects a throwing embedder (isolate FTS)
  // Tier 1: relational invariants — every `above` slug must outrank its `below`.
  rankedAbove?: [above: string, below: string][];
  // Tier 1: hard visibility — these slugs must NEVER appear.
  mustNotContain?: string[];
  // Tier 2: these slugs appear, in this relative order.
  orderedSubset?: string[];
  // Tier 3: exact full ordering of the first page.
  exactOrder?: string[];
  expectPartial?: boolean; // I9 degraded mode
}

export const FIXTURE_USERS: FixtureUser[] = [
  { key: "viewer", id: "fx-user-viewer", name: "Vy Viewer", email: "viewer@fixture.test", handle: "viewer" },
  { key: "friend", id: "fx-user-friend", name: "Fred Friend", email: "friend@fixture.test", handle: "friend" },
  { key: "stranger", id: "fx-user-stranger", name: "Stan Stranger", email: "stranger@fixture.test", handle: "stranger" },
];

export const FIXTURE_TAGS = ["zephyrium", "gardening", "rust-lang"] as const;
export const FIXTURE_CATEGORIES: { name: string; displayName: string }[] = [
  { name: "quokkanet", displayName: "Quokka Networking" },
  { name: "cooking", displayName: "Cooking" },
];

// Helper for ISO dates; explicit so ordering is deterministic.
const d = (n: number) => `2026-01-${String(n).padStart(2, "0")}T00:00:00.000Z`;

export const FIXTURE_POSTS: FixturePost[] = [
  // --- I1 field-weight matched set: same probe term in different fields. ---
  // Body-only is NEWEST so pre-fix (all weight D) it wins on recency tiebreak.
  { slug: "fw-title", ownerKey: "viewer", title: "Zephyrium handbook", excerpt: "Unrelated summary.", content: "Body without the probe.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(1) },
  { slug: "fw-excerpt", ownerKey: "viewer", title: "Unrelated title", excerpt: "A note about zephyrium.", content: "Body without the probe.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(2) },
  { slug: "fw-body", ownerKey: "viewer", title: "Unrelated title", excerpt: "Unrelated summary.", content: "Deep in the body we mention zephyrium once.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(9) },

  // --- I11 tag/category-only match for the same probe term. ---
  { slug: "tag-only", ownerKey: "viewer", title: "Tagged item", excerpt: "Summary.", content: "Body text.", type: "FINDING", status: "PUBLISHED", visibility: "PRIVATE", tags: ["zephyrium"], categories: [], createdAtIso: d(3) },

  // --- I4 more-terms-match > fewer. Query "rust gardening". ---
  { slug: "both-terms", ownerKey: "viewer", title: "Rust and gardening together", excerpt: "On rust and gardening.", content: "Discussion of rust and gardening.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: ["rust-lang", "gardening"], categories: [], createdAtIso: d(4) },
  { slug: "one-term", ownerKey: "viewer", title: "Just gardening", excerpt: "Only gardening here.", content: "All about gardening, nothing else.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: ["gardening"], categories: [], createdAtIso: d(5) },

  // --- I5 phrase/proximity. Query "\"quokka networking\"". ---
  { slug: "phrase-hit", ownerKey: "viewer", title: "Quokka networking explained", excerpt: "quokka networking guide", content: "The phrase quokka networking appears contiguously.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(6) },
  { slug: "phrase-scattered", ownerKey: "viewer", title: "Notes", excerpt: "Scattered.", content: "Quokka care is fun. Networking events are great.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(7) },

  // --- I7 visibility: posts the viewer must NEVER see. ---
  { slug: "stranger-private", ownerKey: "stranger", title: "Zephyrium secret", excerpt: "Private zephyrium.", content: "zephyrium zephyrium zephyrium.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: ["zephyrium"], categories: [], createdAtIso: d(8) },
  { slug: "stranger-public", ownerKey: "stranger", title: "Public zephyrium notes", excerpt: "Public.", content: "zephyrium in public.", type: "BLOG", status: "PUBLISHED", visibility: "PUBLIC", tags: [], categories: [], createdAtIso: d(8) },
  { slug: "friend-friends-pub", ownerKey: "friend", title: "Friendly zephyrium", excerpt: "Friends only.", content: "zephyrium among friends.", type: "BLOG", status: "PUBLISHED", visibility: "FRIENDS", tags: [], categories: [], createdAtIso: d(8) },
  { slug: "friend-friends-draft", ownerKey: "friend", title: "Draft zephyrium", excerpt: "Draft.", content: "zephyrium draft.", type: "BLOG", status: "DRAFT", visibility: "FRIENDS", tags: [], categories: [], createdAtIso: d(8) },

  // --- I10 owner finds own DRAFT. ---
  { slug: "viewer-draft", ownerKey: "viewer", title: "My zephyrium draft", excerpt: "Draft.", content: "zephyrium draft of mine.", type: "BLOG", status: "DRAFT", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(8) },
];

export const GOLDEN_QUERIES: GoldenQuery[] = [
  {
    name: "field-weight: title > excerpt > body (FTS-isolated)",
    query: "zephyrium", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    rankedAbove: [["fw-title", "fw-excerpt"], ["fw-excerpt", "fw-body"]],
  },
  {
    name: "tag match outranks body-only, below title",
    query: "zephyrium", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    rankedAbove: [["fw-title", "tag-only"], ["tag-only", "fw-body"]],
  },
  {
    name: "more terms matched ranks higher",
    query: "rust gardening", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    rankedAbove: [["both-terms", "one-term"]],
  },
  {
    name: "phrase proximity beats scattered terms",
    query: "\"quokka networking\"", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    mustNotContain: ["phrase-scattered"], orderedSubset: ["phrase-hit"],
  },
  {
    name: "visibility never-leak for stranger/friend-draft (scope=all)",
    query: "zephyrium", viewerKey: "viewer", scope: "all", mode: "fts-only",
    mustNotContain: ["stranger-private", "friend-friends-draft"],
  },
  {
    name: "friend FRIENDS + stranger PUBLIC are visible (scope=all)",
    query: "zephyrium", viewerKey: "viewer", scope: "all", mode: "fts-only",
    orderedSubset: ["friend-friends-pub"],
  },
  {
    name: "owner finds own draft (scope=mine)",
    query: "zephyrium", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    orderedSubset: ["viewer-draft"],
  },
  {
    name: "empty query returns nothing",
    query: "   ", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    exactOrder: [],
  },
  {
    name: "degraded mode is partial + FTS-only",
    query: "zephyrium", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    expectPartial: true, orderedSubset: ["fw-title"],
  },
];
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd packages/db && bun run check-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/fixtures/search-corpus.ts
git commit -m "test(search): deterministic fixture corpus + golden query matrix

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Snapshot embeddings regeneration script + committed fixture

**Files:**
- Create: `packages/db/scripts/snapshot-search-fixtures.ts`
- Create (generated): `packages/db/test/fixtures/search-embeddings.json`

**Interfaces:**
- Produces JSON shape: `{ meta: { modelTag: string; dimensionality: number }, posts: Record<slug, number[]>, queries: Record<queryText, number[]> }`.

- [ ] **Step 1: Write the snapshot script**

```ts
// Regenerates search-embeddings.json by embedding every fixture post (document
// side) and every distinct golden query (query side) ONCE via real Gemini.
// Run manually: GEMINI_API_KEY=... bun run packages/db/scripts/snapshot-search-fixtures.ts
// This is the ONLY place Gemini is touched for search tests. Commit the result.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  documentText,
  embedContent,
  embeddingModelTag,
  getEmbeddingDimensionality,
  queryPrefix,
} from "../src/embed-client";
import { FIXTURE_POSTS, GOLDEN_QUERIES } from "../test/fixtures/search-corpus";

async function main() {
  const posts: Record<string, number[]> = {};
  for (const p of FIXTURE_POSTS) {
    const text = documentText(p.title, `${p.excerpt ?? ""}\n${p.content}`);
    posts[p.slug] = await embedContent([{ text }]);
  }
  const queries: Record<string, number[]> = {};
  for (const q of [...new Set(GOLDEN_QUERIES.map((g) => g.query))]) {
    if (!q.trim()) continue;
    queries[q] = await embedContent([{ text: queryPrefix(q) }]);
  }
  const out = {
    meta: { modelTag: embeddingModelTag(), dimensionality: getEmbeddingDimensionality() },
    posts,
    queries,
  };
  const dest = join(import.meta.dir, "../test/fixtures/search-embeddings.json");
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(posts).length} post + ${Object.keys(queries).length} query vectors to ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Generate the fixture (requires a real key)**

Run: `cd /Users/minasaleeb/workspaces/sirius-2-simple && GEMINI_API_KEY="$GEMINI_API_KEY" bun run packages/db/scripts/snapshot-search-fixtures.ts`
Expected: prints "Wrote 13 post + N query vectors…" and `packages/db/test/fixtures/search-embeddings.json` exists with 768-length arrays.

> If `GEMINI_API_KEY` is unavailable to the implementing subagent, STOP and escalate to the orchestrator — this fixture must be generated from real embeddings (per the locked decision), not fabricated.

- [ ] **Step 3: Sanity-check the output**

Run: `cd packages/db && bun -e "const j=require('./test/fixtures/search-embeddings.json'); console.log(j.meta, Object.keys(j.posts).length, j.posts['fw-title'].length)"`
Expected: meta shows `gemini-embedding-2:768`, 13 posts, vector length 768.

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/snapshot-search-fixtures.ts packages/db/test/fixtures/search-embeddings.json
git commit -m "test(search): snapshot regen script + committed embedding fixtures

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Test-DB harness (seed / truncate / embedder / run gate)

**Files:**
- Create: `packages/db/test/search-harness.ts`

**Interfaces:**
- Produces: `RUN_DB: boolean` (true iff `TEST_DATABASE_URL` set), `seedFixtures(): Promise<void>`, `truncateAll(): Promise<void>`, `fixtureEmbedder: QueryEmbedder`, `throwingEmbedder: QueryEmbedder`, `userId(key): string`.

- [ ] **Step 1: Write the harness**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "../src/index";
import type { QueryEmbedder } from "../src/search";
import {
  FIXTURE_CATEGORIES,
  FIXTURE_POSTS,
  FIXTURE_TAGS,
  FIXTURE_USERS,
} from "./fixtures/search-corpus";

export const RUN_DB = !!process.env.TEST_DATABASE_URL;

interface Snapshot {
  meta: { modelTag: string; dimensionality: number };
  posts: Record<string, number[]>;
  queries: Record<string, number[]>;
}
const snapshot: Snapshot = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/search-embeddings.json"), "utf8"),
);

export function userId(key: "viewer" | "friend" | "stranger"): string {
  return FIXTURE_USERS.find((u) => u.key === key)!.id;
}

// Replays snapshot query vectors; throws on an unknown query so a missing
// snapshot fails loudly instead of silently degrading.
export const fixtureEmbedder: QueryEmbedder = async (query) => {
  const v = snapshot.queries[query];
  if (!v) throw new Error(`No snapshot embedding for query: ${JSON.stringify(query)}`);
  return v;
};

// Simulates Gemini being down (I9 degraded mode).
export const throwingEmbedder: QueryEmbedder = async () => {
  throw new Error("embedder unavailable (simulated)");
};

export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "PostEmbedding", "_PostToTag", "_PostToCategory", "Post", "Tag", "Category", "friendship", "user" RESTART IDENTITY CASCADE`,
  );
}

export async function seedFixtures(): Promise<void> {
  await truncateAll();

  for (const u of FIXTURE_USERS) {
    await prisma.user.create({
      data: { id: u.id, name: u.name, email: u.email, emailVerified: true, handle: u.handle },
    });
  }

  // viewer <-> friend are ACCEPTED friends (canonical ordered pair for the unique constraint).
  const [a, b] = [userId("viewer"), userId("friend")].sort();
  await prisma.friendship.create({
    data: { userAId: a, userBId: b, status: "ACCEPTED", requestedById: a, acceptedAt: new Date() },
  });

  for (const t of FIXTURE_TAGS) {
    await prisma.tag.create({ data: { name: t, slug: t } });
  }
  for (const c of FIXTURE_CATEGORIES) {
    await prisma.category.create({ data: { name: c.name, displayName: c.displayName, slug: c.name } });
  }

  for (const p of FIXTURE_POSTS) {
    await prisma.post.create({
      data: {
        slug: p.slug,
        title: p.title,
        content: p.content,
        excerpt: p.excerpt,
        type: p.type,
        status: p.status,
        visibility: p.visibility,
        published: p.status === "PUBLISHED",
        filePath: `fixtures/${p.slug}.md`,
        fileHash: `hash-${p.slug}`,
        submittedById: userId(p.ownerKey),
        createdAt: new Date(p.createdAtIso),
        tags: { connect: p.tags.map((name) => ({ name })) },
        categories: { connect: p.categories.map((name) => ({ name })) },
      },
    });
    const vec = snapshot.posts[p.slug];
    if (!vec) throw new Error(`No snapshot embedding for post: ${p.slug}`);
    await prisma.postEmbedding.create({
      data: {
        postId: (await prisma.post.findUniqueOrThrow({ where: { slug: p.slug }, select: { id: true } })).id,
        ownerId: userId(p.ownerKey),
        retrievalText: `${p.title} ${p.content}`,
        embedding: vec,
        embeddingHash: `hash-${p.slug}`,
        modelVersion: snapshot.meta.modelTag,
        dimensionality: snapshot.meta.dimensionality,
      },
    });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/db && bun run check-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/search-harness.ts
git commit -m "test(search): test-DB harness (seed/truncate/embedder/run gate)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Integration tests — invariants that FAIL pre-fix

**Files:**
- Create: `packages/db/src/search.integration.test.ts`

**Interfaces:**
- Consumes: `searchCorpus`, the harness, the golden matrix.

This task writes the full integration runner but, per TDD, the field-weight (I1) and tag (I11) invariants are expected to **fail** against the current unweighted `searchVector`. The orchestrator must observe these failures before Task 8.

- [ ] **Step 1: Set up the test DB (one-time, orchestrator/CI)**

```bash
# Pick a throwaway DB, e.g. local Postgres:
export TEST_DATABASE_URL="postgresql://postgres@localhost:5432/sirius_search_test"
createdb sirius_search_test 2>/dev/null || true
DATABASE_URL="$TEST_DATABASE_URL" bun --cwd packages/db run db:migrate:deploy
DATABASE_URL="$TEST_DATABASE_URL" bun --cwd packages/db run db:generate
```

- [ ] **Step 2: Write the integration test**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GOLDEN_QUERIES } from "../test/fixtures/search-corpus";
import {
  RUN_DB,
  fixtureEmbedder,
  seedFixtures,
  throwingEmbedder,
  truncateAll,
  userId,
} from "../test/search-harness";
import { searchCorpus } from "./search";

const suite = RUN_DB ? describe : describe.skip;
if (!RUN_DB) {
  console.warn("[search.integration] TEST_DATABASE_URL unset — skipping DB integration suite.");
}

suite("searchCorpus integration (golden matrix)", () => {
  beforeAll(async () => {
    await seedFixtures();
  });
  afterAll(async () => {
    await truncateAll();
  });

  for (const g of GOLDEN_QUERIES) {
    test(g.name, async () => {
      const page = await searchCorpus(userId(g.viewerKey), g.query, {
        scope: g.scope,
        limit: 50,
        embedder: g.mode === "fts-only" ? throwingEmbedder : fixtureEmbedder,
      });
      const slugs = page.items.map((i) => i.slug);

      if (g.expectPartial !== undefined) {
        expect(page.partial).toBe(g.expectPartial);
      }
      for (const [above, below] of g.rankedAbove ?? []) {
        expect(slugs).toContain(above);
        expect(slugs).toContain(below);
        expect(slugs.indexOf(above)).toBeLessThan(slugs.indexOf(below));
      }
      for (const s of g.mustNotContain ?? []) {
        expect(slugs).not.toContain(s);
      }
      if (g.orderedSubset) {
        const idx = g.orderedSubset.map((s) => slugs.indexOf(s));
        expect(idx.every((i) => i >= 0)).toBe(true);
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      }
      if (g.exactOrder) {
        expect(slugs).toEqual(g.exactOrder);
      }
    });
  }
});
```

- [ ] **Step 3: Run — observe the title>body and tag invariants FAIL**

Run: `cd packages/db && DATABASE_URL="$TEST_DATABASE_URL" bun test src/search.integration.test.ts`
Expected: the two field-weight/tag tests FAIL (e.g. `fw-title` does not outrank `fw-body`; `tag-only` not above `fw-body`) because `searchVector` is unweighted and tags aren't indexed. Visibility / empty / degraded / phrase tests should PASS. **Record this failure output for the orchestrator gate.**

- [ ] **Step 4: Commit (red state, intentional)**

```bash
git add packages/db/src/search.integration.test.ts
git commit -m "test(search): integration golden matrix (field-weight invariants red pre-fix)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Ranking fix — weighted, trigger-maintained `searchVector`

**Files:**
- Create: `packages/db/prisma/migrations/20260624130000_weighted_search_vector/migration.sql`
- Modify: `packages/db/src/search.ts` (the `ts_rank` call in `fullTextLeg`)

**Interfaces:** none new; makes Task 7's red tests green.

- [ ] **Step 1: Write the migration SQL**

```sql
-- Replace the unweighted GENERATED searchVector with a trigger-maintained,
-- field-weighted tsvector that also indexes linked tag + category names.
-- Weights: title=A, tags+categories=B, excerpt=C, content=D.

-- 1. Drop the generated column (also drops its dependent GIN index).
ALTER TABLE "Post" DROP COLUMN "searchVector";

-- 2. Re-add as a plain, trigger-maintained tsvector.
ALTER TABLE "Post" ADD COLUMN "searchVector" tsvector;

-- 3. Pure compute function: row text + linked labels, weighted.
--    _PostToTag: "A"=Post, "B"=Tag.  _PostToCategory: "A"=Category, "B"=Post.
CREATE OR REPLACE FUNCTION post_search_vector(
  p_id text, p_title text, p_excerpt text, p_content text
) RETURNS tsvector LANGUAGE sql STABLE AS $$
  SELECT
    setweight(to_tsvector('english', coalesce(p_title, '')), 'A') ||
    setweight(to_tsvector('english',
      coalesce((
        SELECT string_agg(t."name", ' ')
        FROM "_PostToTag" pt JOIN "Tag" t ON t."id" = pt."B"
        WHERE pt."A" = p_id
      ), '') || ' ' ||
      coalesce((
        SELECT string_agg(c."displayName" || ' ' || c."name", ' ')
        FROM "_PostToCategory" pc JOIN "Category" c ON c."id" = pc."A"
        WHERE pc."B" = p_id
      ), '')
    ), 'B') ||
    setweight(to_tsvector('english', coalesce(p_excerpt, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(p_content, '')), 'D')
$$;

-- 4. BEFORE INSERT/UPDATE on Post text columns: recompute from NEW.
CREATE OR REPLACE FUNCTION post_search_vector_biu() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchVector" := post_search_vector(NEW."id", NEW."title", NEW."excerpt", NEW."content");
  RETURN NEW;
END $$;

CREATE TRIGGER post_search_vector_biu_trg
  BEFORE INSERT OR UPDATE OF "title", "excerpt", "content" ON "Post"
  FOR EACH ROW EXECUTE FUNCTION post_search_vector_biu();

-- 5. Linkage triggers: when a tag/category link changes, recompute the post.
--    Updating only "searchVector" does NOT re-fire post_search_vector_biu_trg
--    (it is scoped to title/excerpt/content), so there is no recursion.
CREATE OR REPLACE FUNCTION post_search_vector_tag_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid text := COALESCE(NEW."A", OLD."A");
BEGIN
  UPDATE "Post" SET "searchVector" =
    post_search_vector("id", "title", "excerpt", "content")
  WHERE "id" = pid;
  RETURN NULL;
END $$;

CREATE TRIGGER post_search_vector_tag_link_trg
  AFTER INSERT OR DELETE ON "_PostToTag"
  FOR EACH ROW EXECUTE FUNCTION post_search_vector_tag_link();

CREATE OR REPLACE FUNCTION post_search_vector_cat_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid text := COALESCE(NEW."B", OLD."B");
BEGIN
  UPDATE "Post" SET "searchVector" =
    post_search_vector("id", "title", "excerpt", "content")
  WHERE "id" = pid;
  RETURN NULL;
END $$;

CREATE TRIGGER post_search_vector_cat_link_trg
  AFTER INSERT OR DELETE ON "_PostToCategory"
  FOR EACH ROW EXECUTE FUNCTION post_search_vector_cat_link();

-- 6. Backfill every existing row.
UPDATE "Post" SET "searchVector" =
  post_search_vector("id", "title", "excerpt", "content");

-- 7. Recreate the GIN index.
CREATE INDEX "post_search_vector_idx" ON "Post" USING GIN ("searchVector");
```

- [ ] **Step 2: Update `fullTextLeg` to pass the weight array**

In `packages/db/src/search.ts`, change the `ts_rank` line inside `fullTextLeg`:

```ts
    SELECT p."slug" AS slug,
           ts_rank('{0.1,0.2,0.4,1.0}', p."searchVector", websearch_to_tsquery('english', ${query})) AS rank
```

(The array is `{D,C,B,A}`; the weighting now differentiates because the vector carries `setweight` labels.)

- [ ] **Step 3: Apply the migration to the test DB**

Run: `cd packages/db && DATABASE_URL="$TEST_DATABASE_URL" bun run db:migrate:deploy`
Expected: migration `20260624130000_weighted_search_vector` applied.

- [ ] **Step 4: Re-run the integration suite — now GREEN**

Run: `cd packages/db && DATABASE_URL="$TEST_DATABASE_URL" bun test src/search.integration.test.ts`
Expected: ALL golden-matrix tests PASS, including field-weight and tag invariants.

> Note: re-seeding via `seedFixtures()` inserts posts then connects tags/categories — the linkage triggers fire on the `connect`, so seeded rows get the tag/category weights. Confirm `tag-only` now outranks `fw-body`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations/20260624130000_weighted_search_vector/migration.sql packages/db/src/search.ts
git commit -m "feat(search): field-weighted, tag/category-aware searchVector (title>labels>excerpt>body)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Tier 2/3 hardening — exact snapshots + pagination invariant

**Files:**
- Modify: `packages/db/test/fixtures/search-corpus.ts` (add exact-order + pagination golden queries)
- Modify: `packages/db/src/search.integration.test.ts` (add a pagination-stability test)

**Interfaces:** none new.

- [ ] **Step 1: Add a Tier-3 exact-order golden query**

Append to `GOLDEN_QUERIES` in `search-corpus.ts` — capture the now-correct full ordering for one canonical FTS query (fill `exactOrder` from the green run in Task 8 Step 4):

```ts
  {
    name: "canonical exact ordering: zephyrium scope=mine (FTS)",
    query: "zephyrium", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    // Fill from the Task 8 green run output (slugs in returned order):
    exactOrder: ["fw-title", "tag-only", "fw-excerpt", "viewer-draft", "fw-body"],
  },
```

> Run the query once and paste the actual returned order; do not guess. If the observed order contradicts an invariant (e.g. body above excerpt), STOP and escalate — that is a real ranking bug, not a snapshot to bless.

- [ ] **Step 2: Add the pagination-stability test (I12)**

Append inside the `suite(...)` block in `search.integration.test.ts`:

```ts
  test("pagination is stable: page1 ∪ page2 == full, no dupes/gaps", async () => {
    const opts = { scope: "all" as const, embedder: throwingEmbedder };
    const full = await searchCorpus(userId("viewer"), "zephyrium", { ...opts, limit: 50 });
    const fullSlugs = full.items.map((i) => i.slug);

    const p1 = await searchCorpus(userId("viewer"), "zephyrium", { ...opts, limit: 2 });
    const p2 = await searchCorpus(userId("viewer"), "zephyrium", {
      ...opts, limit: 2, cursor: p1.nextCursor ?? undefined,
    });
    const paged = [...p1.items, ...p2.items].map((i) => i.slug);

    expect(new Set(paged).size).toBe(paged.length); // no dupes
    expect(paged).toEqual(fullSlugs.slice(0, paged.length)); // same prefix order
  });
```

- [ ] **Step 3: Run the full integration suite**

Run: `cd packages/db && DATABASE_URL="$TEST_DATABASE_URL" bun test src/search.integration.test.ts`
Expected: ALL pass, including exact-order + pagination.

- [ ] **Step 4: Commit**

```bash
git add packages/db/test/fixtures/search-corpus.ts packages/db/src/search.integration.test.ts
git commit -m "test(search): Tier-3 exact-order snapshot + pagination-stability invariant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Wire test scripts + final E2E validation gate

**Files:**
- Modify: `packages/db/package.json`

**Interfaces:** none.

- [ ] **Step 1: Add scripts to `packages/db/package.json`**

Add to `"scripts"`:

```json
		"test": "bun test src/search.test.ts",
		"test:search": "DATABASE_URL=\"$TEST_DATABASE_URL\" prisma migrate deploy && DATABASE_URL=\"$TEST_DATABASE_URL\" bun test src/search.test.ts src/search.integration.test.ts"
```

(`test` runs the always-safe pure units; `test:search` runs the full suite against a provisioned `TEST_DATABASE_URL`.)

- [ ] **Step 2: Run the pure suite with no DB (must pass + skip integration cleanly)**

Run: `cd packages/db && bun test`
Expected: pure tests PASS; integration suite logs the skip warning and is skipped (no failure).

- [ ] **Step 3: FINAL E2E GATE — full suite against real Postgres**

Run:
```bash
cd /Users/minasaleeb/workspaces/sirius-2-simple
export TEST_DATABASE_URL="postgresql://postgres@localhost:5432/sirius_search_test"
cd packages/db && bun run test:search
```
Expected: pure + integration ALL green against a real test DB with snapshot embeddings. This is the orchestrator's acceptance gate — no scaffolding-only acceptance.

- [ ] **Step 4: Commit**

```bash
git add packages/db/package.json
git commit -m "chore(search): wire test + test:search scripts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed by author)

**Spec coverage:**
- Embedder seam → Task 3. Weighted/trigger searchVector + tags/categories → Task 8. Snapshot fixtures → Task 5. Fixture corpus + matrix → Task 4. Harness + skip gate → Task 6. Pure units (RRF + visibility) → Tasks 1–2. Invariants I1–I12 → Tasks 4/7/9 (I1 fw-title/excerpt/body; I2/I3 fusion via fused-mode queries — see note; I4 both-terms; I5 phrase; I6 recency via createdAt design; I7 mustNotContain; I8 empty; I9 expectPartial; I10 viewer-draft; I11 tag-only; I12 pagination). Layered assertions → GoldenQuery tiers. TDD red→green → Tasks 7→8. Final E2E gate → Task 10.
- **Note (I2/I3 fusion):** the matrix as written runs invariants in `fts-only` mode to isolate ranking; fused both-legs assertions (exact>similar) rely on `fixtureEmbedder` and the snapshot geometry. If, after Task 8, a fused golden query is desired, add one with `mode: "fused"` and a `rankedAbove` pair where one post matches FTS+embedding and another matches embedding-only. Left as an additive follow-up so it doesn't block the deterministic core.

**Placeholder scan:** No TBD/TODO. Task 9 Step 1 `exactOrder` is explicitly filled from the green run (with a guard to escalate on contradiction) — this is data capture, not a placeholder.

**Type consistency:** `QueryEmbedder`, `rankByCosine`, `seedFixtures`, `truncateAll`, `fixtureEmbedder`, `throwingEmbedder`, `userId`, `RUN_DB` names are consistent across Tasks 3/6/7/9. `GoldenQuery`/`FixturePost` fields match harness usage.

## Risks captured
- Trigger recursion avoided by scoping the BEFORE trigger to `title/excerpt/content`. Verify in Task 8 Step 4.
- `TRUNCATE` lists `"user"`/`"friendship"` (the `@@map` names), not `User`/`Friendship`. Verified against schema `@@map`.
- Snapshot staleness on model/dim change → re-run Task 5 script (documented).
```
