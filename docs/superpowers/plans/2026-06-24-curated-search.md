# Curated Corpus Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose the MCP server's full-text and embedding retrieval into one curated, visibility-gated search that the user drives from the web catalog and mobile library, with results blended via Reciprocal Rank Fusion.

**Architecture:** A single shared core `searchCorpus()` in `@repo/db` runs real Postgres full-text (tsvector + ts_rank) AND brute-force embedding cosine over the viewer-visible candidate set, then fuses both ranked lists via RRF into one `SearchHit[]` carrying match reasons. One session-authed route `/api/app/search` wraps it; web `/catalog` and mobile library call it. The MCP `keywordSearch`/`semanticSearch` are refactored to call the same cores so UI and MCP never drift.

**Tech Stack:** Postgres (Prisma 7 + `@prisma/adapter-pg`, raw SQL for FTS), `gemini-embedding-2` (768-dim) via `@repo/db` embed-client, Next.js 16 App Router, Expo/React Native + React Query, Stitch (UX) + v0 (component).

## Global Constraints

- Package manager: **bun** (`bun@1.3.14`). Run `bun run db:generate` after any schema change before typecheck/build.
- Prisma raw-SQL gotchas: void-returning fns need `$executeRaw`; **no `CREATE INDEX CONCURRENTLY`** in a migration (aborts inside the deploy txn) — plain index only. Migrations are **hand-authored SQL** + `bun run db:migrate:deploy` (never `migrate dev` in an agent shell).
- Next.js Cache Components: **no `export const dynamic`/`runtime`** in route handlers; handlers are dynamic via session reads.
- Visibility is non-negotiable: friends'/public tiers are **PUBLISHED-only**; only the viewer's OWN posts may surface at any status. FTS and embedding candidate queries MUST share one visibility predicate so they never drift.
- Owner-scoping: never trust a client-supplied owner; the route passes `session.user.id` only.
- No test runner exists. "Verify" = `bun run check-types` + `bun run lint` (per-app, `--max-warnings 0`) + manual runtime checks against the dev stack.
- Embedding model tag must match the worker's (`embeddingModelTag()` → `gemini-embedding-2:768`); query embeds via `embedContent([{ text: queryPrefix(query) }])`.

---

### Task 1: Postgres full-text column + GIN index (migration)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add `searchVector` field to `Post`)
- Create: `packages/db/prisma/migrations/<timestamp>_post_search_vector/migration.sql`

**Interfaces:**
- Produces: a `Post.searchVector tsvector` generated column (from `title + excerpt + content`) with GIN index `post_search_vector_idx`, queryable via raw SQL `websearch_to_tsquery('english', $q)`.

- [ ] **Step 1: Add the field to the Prisma schema**

In `packages/db/prisma/schema.prisma`, inside `model Post`, add (next to the other scalar fields):

```prisma
  /// Generated FTS vector over title+excerpt+content. Managed by hand-authored
  /// migration (generated column); queried only via raw SQL. Unsupported so
  /// Prisma generate knows the column exists without trying to manage it.
  searchVector Unsupported("tsvector")?
```

- [ ] **Step 2: Hand-author the migration SQL**

Create `packages/db/prisma/migrations/20260624000000_post_search_vector/migration.sql`:

```sql
-- Full-text search over Post bodies. Generated STORED tsvector (immutable
-- because the regconfig is a constant literal) + GIN index. Plain index (no
-- CONCURRENTLY — that aborts inside migrate deploy's transaction).
ALTER TABLE "Post"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce("title", '') || ' ' ||
      coalesce("excerpt", '') || ' ' ||
      coalesce("content", '')
    )
  ) STORED;

CREATE INDEX "post_search_vector_idx" ON "Post" USING GIN ("searchVector");
```

- [ ] **Step 3: Apply + regenerate**

Run:
```sh
bun run db:migrate:deploy
bun run db:generate
```
Expected: migration applies cleanly; generate succeeds.

- [ ] **Step 4: Verify the column + index exist and match**

Run (psql against `DATABASE_URL`, strip `?schema=` per the Prisma-7 psql note):
```sh
psql "$DATABASE_URL" -c "SELECT slug FROM \"Post\" WHERE \"searchVector\" @@ websearch_to_tsquery('english', 'the') LIMIT 3;"
```
Expected: returns up to 3 slugs (or zero rows on an empty DB) with NO error — proves the column + tsquery operator resolve.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260624000000_post_search_vector/migration.sql
git commit -m "feat(db): add Post.searchVector FTS column + GIN index"
```

---

### Task 2: Shared search core in `@repo/db`

**Files:**
- Modify: `packages/db/src/embeddings.ts` (add `listVisiblePostEmbeddings`)
- Create: `packages/db/src/search.ts` (visibility predicate, FTS, fusion, `searchCorpus`)
- Modify: `packages/db/src/index.ts` (re-export the new surface)

**Interfaces:**
- Consumes: `embedContent`, `queryPrefix`, `cosineSimilarity` (embed-client), `listPostsBySlugs` (posts.ts), `friendIdsOf` (friends.ts), `prisma`, `Prisma`, `PostStatus`, `PostVisibility`.
- Produces:
  - `searchVisibilityWhere(viewerId: string, friendIds: string[], includePublic: boolean): Prisma.PostWhereInput`
  - `listVisiblePostEmbeddings(viewerId, friendIds, includePublic): Promise<VisiblePostEmbedding[]>` where `VisiblePostEmbedding = { embedding: number[]; retrievalText: string; slug: string; title: string }`
  - `type SearchHit = { slug: string; title: string; excerpt: string | null; type: string; status: string; categories: {slug:string;name:string}[]; tags: {slug:string;name:string}[]; submittedBy: SubmitterSummary | null; createdAt: string; score: number; snippet: string; matchReasons: ('exact'|'similar')[] }`
  - `type SearchPage = { items: SearchHit[]; nextCursor: string | null; partial: boolean }`
  - `searchCorpus(viewerId: string, query: string, opts: { scope?: 'all'|'mine'; limit?: number; cursor?: string }): Promise<SearchPage>`

- [ ] **Step 1: Add the visibility-gated embedding candidate loader**

In `packages/db/src/embeddings.ts`, add at the end (import `Prisma`, `PostStatus`, `PostVisibility` from `../generated/prisma` — extend the existing import line):

```ts
export interface VisiblePostEmbedding {
  embedding: number[];
  retrievalText: string;
  slug: string;
  title: string;
}

// Embedding candidate set the viewer may search: own posts (any status) plus
// friends' FRIENDS and PUBLIC posts (PUBLISHED only). Shares its visibility
// shape with searchVisibilityWhere (search.ts) so FTS and embedding legs never
// disagree about what's reachable.
export async function listVisiblePostEmbeddings(
  viewerId: string,
  friendIds: string[],
  includePublic: boolean,
): Promise<VisiblePostEmbedding[]> {
  const or: Prisma.PostWhereInput[] = [{ submittedById: viewerId }];
  if (friendIds.length > 0) {
    or.push({
      submittedById: { in: friendIds },
      visibility: PostVisibility.FRIENDS,
      status: PostStatus.PUBLISHED,
    });
  }
  if (includePublic) {
    or.push({ visibility: PostVisibility.PUBLIC, status: PostStatus.PUBLISHED });
  }
  const rows = await prisma.postEmbedding.findMany({
    where: { post: { OR: or } },
    select: {
      embedding: true,
      retrievalText: true,
      post: { select: { slug: true, title: true } },
    },
  });
  return rows.map((r) => ({
    embedding: r.embedding,
    retrievalText: r.retrievalText,
    slug: r.post.slug,
    title: r.post.title,
  }));
}
```

- [ ] **Step 2: Create the search core**

Create `packages/db/src/search.ts`:

```ts
// Curated corpus search: composes Postgres full-text (tsvector + ts_rank) and
// brute-force embedding cosine over the viewer-visible candidate set, then fuses
// both ranked lists via Reciprocal Rank Fusion. The single source of truth shared
// by /api/app/search (web + mobile) and the MCP keyword/semantic tools.
import { PostStatus, PostVisibility, Prisma } from "../generated/prisma";
import {
  cosineSimilarity,
  embedContent,
  queryPrefix,
} from "./embed-client";
import { listVisiblePostEmbeddings } from "./embeddings";
import { prisma } from "./index";
import { listPostsBySlugsVisible, type SubmitterSummary } from "./posts";

export type MatchReason = "exact" | "similar";

export interface SearchHit {
  slug: string;
  title: string;
  excerpt: string | null;
  type: string;
  status: string;
  categories: { slug: string; name: string }[];
  tags: { slug: string; name: string }[];
  submittedBy: SubmitterSummary | null;
  createdAt: string;
  score: number;
  snippet: string;
  matchReasons: MatchReason[];
}

export interface SearchPage {
  items: SearchHit[];
  nextCursor: string | null;
  // True when the embedding leg failed (Gemini down) and results are full-text
  // only — the UI shows a subtle "similar matches unavailable" note.
  partial: boolean;
}

const RRF_K = 60;
const FUSION_CANDIDATES = 50;
const SNIPPET_MAX = 280;

// The ONE visibility predicate, shared with listVisiblePostEmbeddings: own posts
// (any status) OR friends' FRIENDS (published) OR PUBLIC (published, if allowed).
export function searchVisibilityWhere(
  viewerId: string,
  friendIds: string[],
  includePublic: boolean,
): Prisma.PostWhereInput {
  const or: Prisma.PostWhereInput[] = [{ submittedById: viewerId }];
  if (friendIds.length > 0) {
    or.push({
      submittedById: { in: friendIds },
      visibility: PostVisibility.FRIENDS,
      status: PostStatus.PUBLISHED,
    });
  }
  if (includePublic) {
    or.push({ visibility: PostVisibility.PUBLIC, status: PostStatus.PUBLISHED });
  }
  return { OR: or };
}

// Full-text leg: rank by ts_rank over the generated tsvector, visibility-gated
// inline in raw SQL (the predicate mirrors searchVisibilityWhere). websearch_to_
// tsquery gives users quote/OR/- syntax for free. Empty friendIds → ANY('{}')
// matches nothing; includePublic toggles the PUBLIC clause.
async function fullTextLeg(
  viewerId: string,
  query: string,
  friendIds: string[],
  includePublic: boolean,
  limit: number,
): Promise<string[]> {
  const publicClause = includePublic
    ? Prisma.sql`OR (p."visibility" = 'PUBLIC' AND p."status" = 'PUBLISHED')`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<{ slug: string }[]>`
    SELECT p."slug" AS slug,
           ts_rank(p."searchVector", websearch_to_tsquery('english', ${query})) AS rank
    FROM "Post" p
    WHERE p."searchVector" @@ websearch_to_tsquery('english', ${query})
      AND (
        p."submittedById" = ${viewerId}
        OR (p."visibility" = 'FRIENDS' AND p."status" = 'PUBLISHED'
            AND p."submittedById" = ANY(${friendIds}))
        ${publicClause}
      )
    ORDER BY rank DESC, p."createdAt" DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.slug);
}

// Embedding leg: embed the query in the worker's space, cosine over the visible
// candidate set, return slugs ranked by similarity. Returns null (not throw) when
// the embedding call fails so searchCorpus can degrade to full-text only.
async function semanticLeg(
  viewerId: string,
  query: string,
  friendIds: string[],
  includePublic: boolean,
  limit: number,
): Promise<string[] | null> {
  let queryVector: number[];
  try {
    queryVector = await embedContent([{ text: queryPrefix(query) }]);
  } catch {
    return null;
  }
  const candidates = await listVisiblePostEmbeddings(
    viewerId,
    friendIds,
    includePublic,
  );
  return candidates
    .map((c) => ({ slug: c.slug, score: cosineSimilarity(queryVector, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.slug);
}

// Reciprocal Rank Fusion: each list contributes 1/(k+rank); a slug present in
// both legs accumulates both contributions AND collects both reasons.
export function reciprocalRankFusion(
  fullText: string[],
  semantic: string[],
): { slug: string; score: number; matchReasons: MatchReason[] }[] {
  const acc = new Map<string, { score: number; reasons: Set<MatchReason> }>();
  const add = (slugs: string[], reason: MatchReason) => {
    slugs.forEach((slug, i) => {
      const cur = acc.get(slug) ?? { score: 0, reasons: new Set<MatchReason>() };
      cur.score += 1 / (RRF_K + i);
      cur.reasons.add(reason);
      acc.set(slug, cur);
    });
  };
  add(fullText, "exact");
  add(semantic, "similar");
  return [...acc.entries()]
    .map(([slug, v]) => ({
      slug,
      score: v.score,
      matchReasons: [...v.reasons].sort(),
    }))
    .sort((a, b) => b.score - a.score);
}

function makeSnippet(text: string | null): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > SNIPPET_MAX ? `${clean.slice(0, SNIPPET_MAX)}…` : clean;
}

// The single curated entry point. cursor is an opaque offset into the fused list
// (string integer) — the fused rank is fully recomputed per call (cheap at this
// scale), so paging just slices a stable ordering.
export async function searchCorpus(
  viewerId: string,
  query: string,
  opts: { scope?: "all" | "mine"; limit?: number; cursor?: string } = {},
): Promise<SearchPage> {
  const q = query.trim();
  if (!q) return { items: [], nextCursor: null, partial: false };

  const limit = Math.min(50, Math.max(1, opts.limit ?? 24));
  const offset = Math.max(0, Number.parseInt(opts.cursor ?? "0", 10) || 0);
  const scopeAll = (opts.scope ?? "all") === "all";

  const friendIds = scopeAll ? await friendIdsOf(viewerId) : [];
  const includePublic = scopeAll;

  const [ftSlugs, semSlugs] = await Promise.all([
    fullTextLeg(viewerId, q, friendIds, includePublic, FUSION_CANDIDATES),
    semanticLeg(viewerId, q, friendIds, includePublic, FUSION_CANDIDATES),
  ]);
  const partial = semSlugs === null;
  const fused = reciprocalRankFusion(ftSlugs, semSlugs ?? []);

  const pageRanked = fused.slice(offset, offset + limit);
  const hasMore = fused.length > offset + limit;

  // Hydrate the page's slugs with full post metadata, visibility-gated so a
  // slug the viewer can't actually read is dropped (defense in depth).
  const full = await listPostsBySlugsVisible(
    pageRanked.map((r) => r.slug),
    searchVisibilityWhere(viewerId, friendIds, includePublic),
  );
  const bySlug = new Map(full.map((p) => [p.slug, p]));

  const items: SearchHit[] = pageRanked.flatMap((r) => {
    const post = bySlug.get(r.slug);
    if (!post) return [];
    return [
      {
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        type: post.type,
        status: post.status,
        categories: post.categories.map((c) => ({ slug: c.slug, name: c.name })),
        tags: post.tags.map((t) => ({ slug: t.slug, name: t.name })),
        submittedBy: post.submittedBy,
        createdAt: post.createdAt.toISOString(),
        score: r.score,
        snippet: makeSnippet(post.excerpt ?? post.content),
        matchReasons: r.matchReasons,
      },
    ];
  });

  return {
    items,
    nextCursor: hasMore ? String(offset + limit) : null,
    partial,
  };
}

// friendIdsOf is imported lazily to avoid a circular import at module load.
import { friendIdsOf } from "./friends";
```

- [ ] **Step 3: Add the visibility-gated slug hydrator to posts.ts**

In `packages/db/src/posts.ts`, add after `listPostsBySlugs` (it needs the visibility predicate, NOT owner-only, since search spans friends/public):

```ts
// Like listPostsBySlugs but gated by an arbitrary visibility predicate (from
// search.ts) instead of owner-only — search results span the viewer's own posts
// AND friends'/public ones. Order is NOT preserved; the caller re-orders by its
// fused rank and looks rows up by slug.
export function listPostsBySlugsVisible(
  slugs: string[],
  visibilityWhere: Prisma.PostWhereInput,
): Promise<PostWithRelations[]> {
  if (slugs.length === 0) return Promise.resolve([]);
  return prisma.post.findMany({
    where: { AND: [{ slug: { in: slugs } }, visibilityWhere] },
    include: {
      tags: true,
      categories: true,
      submittedBy: {
        select: { id: true, name: true, handle: true, image: true },
      },
    },
  }) as Promise<PostWithRelations[]>;
}
```

- [ ] **Step 4: Re-export from the package index**

In `packages/db/src/index.ts`, add to the existing re-export blocks:

```ts
export {
  searchCorpus,
  searchVisibilityWhere,
  reciprocalRankFusion,
  type SearchHit,
  type SearchPage,
  type MatchReason,
} from "./search";
export {
  listVisiblePostEmbeddings,
  type VisiblePostEmbedding,
} from "./embeddings";
export { listPostsBySlugsVisible } from "./posts";
```

(If `./embeddings` / `./posts` are already partially re-exported, add only the missing names.)

- [ ] **Step 5: Typecheck**

Run:
```sh
bun run db:generate && bun run check-types --filter=@repo/db
```
Expected: PASS. Fix any circular-import or type errors (the `friendIdsOf` import is intentionally at the bottom of search.ts; if the bundler complains, move it to the top import block).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/search.ts packages/db/src/embeddings.ts packages/db/src/posts.ts packages/db/src/index.ts
git commit -m "feat(db): add searchCorpus FTS+embedding RRF core"
```

---

### Task 3: Refactor MCP keyword/semantic tools onto the shared cores

**Files:**
- Modify: `apps/mcp/src/retrieval/keyword.ts` (`keywordSearch` → FTS leg)
- Modify: `apps/mcp/src/retrieval/semantic.ts` (`semanticSearch` reuse note)

**Interfaces:**
- Consumes: `searchCorpus`, `SearchHit` from `@repo/db`.
- Produces: unchanged tool contracts (`SearchPage { items: PostSummary[]; nextCursor }`, `SemanticHit[]`).

- [ ] **Step 1: Point `keywordSearch` at real FTS via searchCorpus (mine-scope)**

Replace the body of `keywordSearch` in `apps/mcp/src/retrieval/keyword.ts`. MCP tools are owner-scoped, so use `scope: "mine"`:

```ts
import { searchCorpus } from "@repo/db";
// ... keep browsePosts as-is ...

export async function keywordSearch(
  ownerId: string,
  query: string,
  params: { limit?: number; cursor?: string } = {},
): Promise<SearchPage> {
  const page = await searchCorpus(ownerId, query, {
    scope: "mine",
    limit: params.limit,
    cursor: params.cursor,
  });
  return {
    items: page.items.map((h) => ({
      slug: h.slug,
      title: h.title,
      excerpt: h.excerpt,
      type: h.type,
      status: h.status,
      categories: h.categories.map((c) => c.name),
      tags: h.tags.map((t) => t.name),
      createdAt: h.createdAt,
    })),
    nextCursor: page.nextCursor,
  };
}
```

(Confirm `PostSummary` field shape against `apps/mcp/src/retrieval/summary.ts`; map accordingly. If `PostSummary.categories/tags` are string arrays this is exact; if objects, drop the `.map`.)

- [ ] **Step 2: Leave semantic.ts contract intact, add a reuse note**

`semanticSearch` already works owner-scoped via `getEmbeddingSceneRows`. Do NOT rewire it (its `SemanticHit` includes a score the MCP tool surfaces). Add a one-line comment above `semanticSearch` pointing to `@repo/db searchCorpus` as the fused superset used by the UI, so a future reader knows the relationship. No behavior change.

- [ ] **Step 3: Typecheck**

Run:
```sh
bun run check-types --filter=mcp
```
(Use the actual MCP package name from `apps/mcp/package.json` if not `mcp`.)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mcp/src/retrieval/keyword.ts apps/mcp/src/retrieval/semantic.ts
git commit -m "refactor(mcp): keyword tool reuses shared searchCorpus FTS core"
```

---

### Task 4: `/api/app/search` route

**Files:**
- Create: `apps/web/app/api/app/search/route.ts`

**Interfaces:**
- Consumes: `searchCorpus` from `@repo/db`, `getSessionOrNull` from `apps/web/lib/session`.
- Produces: `GET /api/app/search?q=&scope=&limit=&cursor=` → `SearchPage` JSON.

- [ ] **Step 1: Implement the handler**

Create `apps/web/app/api/app/search/route.ts`:

```ts
import { searchCorpus } from "@repo/db";
import { getSessionOrNull } from "../../../../lib/session";

// Curated corpus search (full-text + embedding, RRF-fused). Session-authed; the
// viewer id is the only owner the search trusts. No route segment config exports
// (Cache Components) — the session read makes this dynamic.
export async function GET(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const scope = url.searchParams.get("scope") === "mine" ? "mine" : "all";
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

  if (!q) {
    return Response.json({ items: [], nextCursor: null, partial: false });
  }

  try {
    const page = await searchCorpus(session.user.id, q, { scope, cursor, limit });
    return Response.json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : "search failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run:
```sh
bun run check-types --filter=web
```
Expected: PASS.

- [ ] **Step 3: Manual smoke against dev**

With the dev stack running and signed in, in the browser console:
```js
await (await fetch('/api/app/search?q=test')).json()
```
Expected: `{ items: [...], nextCursor, partial }`. Confirm a body-only term (a word that appears in a post's `content` but not its title) returns that post — proving FTS over `content`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/app/search/route.ts
git commit -m "feat(web): add /api/app/search route over searchCorpus"
```

---

### Task 5: Search UI design — Stitch → v0

**Files:**
- Create: `docs/superpowers/specs/search-ui/` (exported Stitch design + v0 output reference)

**Interfaces:**
- Produces: a v0-generated React search component (field + blended result rows with `exact`/`similar` badges + loading/empty/partial states) to adapt for web, and a visual spec to port to RN.

- [ ] **Step 1: Generate the UX in Stitch**

Use `mcp__stitch__create_project` + `mcp__stitch__generate_screen_from_text` with a prompt describing: a search field (debounced, placeholder), a blended result list where each row shows title, snippet, a category pill + tag chips, and one or two small badges (`exact` / `similar`) indicating why it matched; plus empty, loading-skeleton, and "similar matches unavailable" partial states. Theme to the app's existing palette (mono labels, `--color-accent`, display-italic headings as seen in `catalog/search.tsx`). Save the screen reference.

- [ ] **Step 2: Generate the component in v0**

Use `mcp__v0__createChat` to turn the Stitch design into a self-contained React + Tailwind search component whose props are `{ value, onChange, items: SearchHit[], isLoading, partial }`. Capture the generated source.

- [ ] **Step 3: Record the design reference**

Save the v0 chat URL/id and a screenshot/markdown summary into `docs/superpowers/specs/search-ui/README.md` so web + mobile implementers share one visual contract.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/search-ui
git commit -m "docs(search): Stitch UX + v0 component reference for curated search"
```

---

### Task 6: Web `/catalog` integration

**Files:**
- Create: `apps/web/app/(public)/catalog/curated-search.tsx` (client component)
- Modify: `apps/web/app/(public)/catalog/page.tsx` (mount the curated search; keep existing list as the no-query default)

**Interfaces:**
- Consumes: `GET /api/app/search`, the v0 component from Task 5, `SearchHit` type from `@repo/db`.
- Produces: a live curated-search experience on `/catalog`.

- [ ] **Step 1: Build the client search component**

Create `apps/web/app/(public)/catalog/curated-search.tsx`: a `"use client"` component with a debounced (250ms) query input; on non-empty query it fetches `/api/app/search?q=...` (abortable, cancel in-flight on keystroke), renders the v0-styled blended rows with `exact`/`similar` badges, a loading skeleton, an empty state, and a subtle "Similar matches unavailable" note when `partial`. Each row links to `/listing/${slug}` (match the catalog's existing post link target — confirm in `page.tsx`). Type the response as `{ items: SearchHit[]; nextCursor: string | null; partial: boolean }` imported from `@repo/db`.

- [ ] **Step 2: Mount it on the catalog page**

In `apps/web/app/(public)/catalog/page.tsx`, render `<CuratedSearch />` in place of (or above) the existing `<CatalogSearch />`. When the query is empty the existing server-rendered catalog list remains the default view; the curated results overlay/replace the list only while a query is active.

- [ ] **Step 3: Typecheck + lint**

Run:
```sh
bun run check-types --filter=web && bun run lint --filter=web
```
Expected: PASS, 0 warnings.

- [ ] **Step 4: Manual verify in browser**

Dev stack running, signed in, visit `/catalog`. Type a query; confirm (a) debounce, (b) blended rows with correct badges, (c) a semantically-related post with no literal term match appears with a `similar` badge, (d) empty state for gibberish.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(public)/catalog/curated-search.tsx" "apps/web/app/(public)/catalog/page.tsx"
git commit -m "feat(web): curated search on /catalog"
```

---

### Task 7: Mobile library search overlay

**Files:**
- Create: `apps/mobile/src/lib/search/use-corpus-search.ts` (React Query hook)
- Modify: `apps/mobile/src/app/(tabs)/library.tsx` (add search field + results mode)

**Interfaces:**
- Consumes: `apiGet` from `apps/mobile/src/lib/api.ts`; `SearchHit`/`SearchPage` shapes (declare a local mirror type — mobile doesn't import `@repo/db`).
- Produces: a networked search overlay on the library tab.

- [ ] **Step 1: Declare the wire types + fetch hook**

Create `apps/mobile/src/lib/search/use-corpus-search.ts` with a local `SearchHit`/`SearchPage` type matching the route's JSON, a 250ms-debounced query, and `useInfiniteQuery` calling `apiGet<SearchPage>(\`/api/app/search?q=${encodeURIComponent(q)}&limit=24${cursor ? \`&cursor=${cursor}\` : ""}\`)`, `getNextPageParam: (last) => last.nextCursor`, `enabled: q.length > 0`, `retry` skipping on `ApiError.status === 401`.

- [ ] **Step 2: Add the search field + results mode to library**

In `apps/mobile/src/app/(tabs)/library.tsx`: add a search `TextInput` at the top. When non-empty, render a `FlatList` of search hits (blended-row layout ported from the v0 design: title, snippet, type tone pill, `exact`/`similar` badges) tapping to `/post/${slug}`, with the existing local-mirror category/tag browse shown only when the field is empty. Show a "Similar matches unavailable" line when `partial`. Keep the existing scope toggle independent (search always hits the network).

- [ ] **Step 3: Typecheck + lint**

Run:
```sh
bun run check-types --filter=mobile && bun run lint --filter=mobile
```
Expected: PASS, 0 warnings.

- [ ] **Step 4: Manual verify on simulator**

Per `prefer-user-manual-testing`: give the user exact steps — boot the app, open Library, type a query, confirm blended rows + badges + tap-through, and that a body-only term surfaces a post. Collect their report.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/search/use-corpus-search.ts "apps/mobile/src/app/(tabs)/library.tsx"
git commit -m "feat(mobile): curated search overlay on library tab"
```

---

### Task 8: End-to-end verification + docs

**Files:**
- Modify: `CLAUDE.md` (one line documenting the search surface, if warranted)

- [ ] **Step 1: Cross-surface verification matrix**

With real data, confirm on web (and spot-check mobile): (a) body-only match surfaces (FTS over `content`), (b) semantic-only match surfaces with `similar` badge (embedding leg), (c) a friend's PUBLIC post surfaces under default `all` scope but not `scope=mine` (visibility gating), (d) RRF puts a both-legs hit above single-leg hits, (e) embedding-down path returns FTS results with `partial: true`, (f) MCP `full_text_search` tool still returns sane results post-refactor.

- [ ] **Step 2: Note the feature in CLAUDE.md**

Add a sentence under the web route-groups / API section noting `/api/app/search` (searchCorpus: FTS + embedding RRF, visibility-gated) and that the catalog + mobile library consume it.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document curated search surface"
```

## Self-Review

- **Spec coverage:** FTS-over-content (Task 1+2), embedding leg reusing patterns (Task 2), RRF blend with reasons (Task 2), visibility gating mine+friends+public (Task 2 shared predicate), one API route (Task 4), MCP reuse (Task 3), Stitch+v0 UI (Task 5), web catalog + mobile library surfaces (Task 6/7), manual verification incl. partial/degrade (Task 8). All spec sections map to a task.
- **Type consistency:** `SearchHit`/`SearchPage`/`MatchReason` defined in Task 2 and consumed verbatim in Tasks 3/4/6/7; `searchVisibilityWhere`/`listVisiblePostEmbeddings`/`listPostsBySlugsVisible` defined and used consistently; `searchCorpus(viewerId, query, opts)` signature stable across route + MCP.
- **Open verification risk:** the `Prisma.sql`/`= ANY(${friendIds})` array binding and the generated-column immutability are the two Postgres-specific bits to confirm live in Task 1 Step 4 and Task 4 Step 3; both have explicit manual checks.
