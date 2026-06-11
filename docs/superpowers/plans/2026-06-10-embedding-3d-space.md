# Embedding 3D Space (web + mobile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Orchestration contract (ralph-loop + beads + agent-mail):** each task below maps 1:1 to a bead in epic `es-*`. A cold agent claims ONE ready (unblocked) bead, registers with Agent Mail (`macro_start_session`), reserves the task's files (`file_reservation_paths`) before editing, implements, verifies, closes the bead with a close reason, releases reservations, and reports via `send_message`. Unblocked beads may run concurrently — the file lists below are disjoint by design.

**Goal:** Let a signed-in user see their captured content, Focus Areas (Projects), and the global Analysis Category taxonomy as an interactive 3D point cloud with tree/assignment/match edges, on web (Next.js) and mobile (Expo), driven by one shared scene data structure.

**Architecture:** Persist the content vectors the worker already computes (new `PostEmbedding` + `PostCategoryMatch` linkage tables). A new pure-TS workspace package `@repo/embedding-scene` owns the shared data types, deterministic PCA→3D projection, and scene assembly (nodes + edges). The web app serves the assembled `EmbeddingScene` JSON from a session-authed API route; the web page renders it with react-three-fiber, mobile renders the same scene component tree via `@react-three/fiber/native` + `expo-gl`. Hosts differ only in camera controls and the selection overlay.

**Tech Stack:** Prisma 7 (Float[] columns, existing pattern), `@google/genai` gemini-embedding-2 (existing client), `three` ^0.182.0, `@react-three/fiber` ^9 (web + native), `@react-three/drei` ^10 (web OrbitControls only), `expo-gl` ~56, React 19.2, Next 16, Zod 4.

**Verification policy (repo rule):** there is NO test runner in this repo. Every task verifies with `bun run check-types`, `bun run lint`, and (where stated) a smoke script under `apps/worker/scripts/` or manual `bun run db:studio`. Never claim tests pass.

**Source-of-truth references:**
- Embedding client: `apps/worker/src/lib/embeddings.ts` (embedContent, queryPrefix, embeddingHash)
- Classifier: `packages/db/src/classify.ts` (classifyContent, CategoryMatch)
- Auto-org stage: `apps/worker/src/pipeline/classification/assign-org.ts`
- DB helper conventions: `packages/db/src/embeddings.ts` (ProjectEmbedding helpers)
- API route conventions: `apps/web/app/api/app/projects/route.ts` (getSessionOrNull + jsonError)
- Mobile API helper: `apps/mobile/src/lib/api.ts`
- Shared package conventions: `packages/ui/package.json` (raw-TS exports, consumer transpiles)

---

### Task 1: Schema — PostEmbedding + PostCategoryMatch + DB helpers

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/embeddings.ts`
- Modify: `packages/db/src/index.ts`
- Create: migration via prisma (generated)

- [ ] **Step 1: Add models to `packages/db/prisma/schema.prisma`**

Insert after the `ProjectEmbedding` model:

```prisma
// One embedding per Post, persisted by the worker at classify time (or by the
// backfill script). ownerId denormalizes Post.submittedById for cheap
// owner-scoped scene reads; null = bearer ingest (excluded from per-user scenes).
model PostEmbedding {
  id             String   @id @default(cuid())
  postId         String   @unique
  post           Post     @relation("PostEmbedding", fields: [postId], references: [id], onDelete: Cascade)
  ownerId        String?
  retrievalText  String
  embedding      Float[]
  embeddingHash  String
  modelVersion   String
  dimensionality Int
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([ownerId])
  @@index([embeddingHash])
}

// Linkage: which Analysis Categories a post matched at classify time (top-K above
// threshold). path is a soft reference to CategoryEmbedding.path (taxonomy rows
// are keyed/upserted by path). Kept as rows, not JSON, so the scene API and
// future queries can traverse post<->category links relationally.
model PostCategoryMatch {
  id        String   @id @default(cuid())
  postId    String
  post      Post     @relation("PostCategoryMatches", fields: [postId], references: [id], onDelete: Cascade)
  path      String
  score     Float
  createdAt DateTime @default(now())

  @@unique([postId, path])
  @@index([path])
}
```

Add back-relations inside `model Post` (next to the existing `project` relation fields):

```prisma
  embedding       PostEmbedding?      @relation("PostEmbedding")
  categoryMatches PostCategoryMatch[] @relation("PostCategoryMatches")
```

- [ ] **Step 2: Migrate + generate**

Run (prisma directly inside the package — turbo/bun mangle `--name`):
```bash
cd packages/db && bunx prisma migrate dev --name add_post_embedding_linkage && cd ../..
bun run db:generate
```
Expected: migration applies, client regenerates.

- [ ] **Step 3: Add helpers to `packages/db/src/embeddings.ts`**

Append:

```ts
export interface UpsertPostEmbeddingInput {
  postId: string;
  ownerId: string | null;
  retrievalText: string;
  embedding: number[];
  embeddingHash: string;
  modelVersion: string;
  dimensionality: number;
}

// Idempotent by postId; re-embeds overwrite (embeddingHash lets callers skip
// unchanged content before calling).
export async function upsertPostEmbedding(
  input: UpsertPostEmbeddingInput
): Promise<PostEmbedding> {
  const { postId, ...rest } = input;
  return prisma.postEmbedding.upsert({
    where: { postId },
    create: { postId, ...rest },
    update: rest,
  });
}

// Replace the post's category linkage with the latest classify result.
export async function replacePostCategoryMatches(
  postId: string,
  matches: { path: string; score: number }[]
): Promise<void> {
  await prisma.$transaction([
    prisma.postCategoryMatch.deleteMany({ where: { postId } }),
    prisma.postCategoryMatch.createMany({
      data: matches.map((m) => ({ postId, path: m.path, score: m.score })),
    }),
  ]);
}

// Everything the embedding-scene needs for one owner, in one read. Categories
// are global; posts/projects are owner-scoped. Matches ride along per post.
export interface EmbeddingSceneRows {
  categories: CategoryEmbedding[];
  projects: (ProjectEmbedding & { project: { title: string } })[];
  posts: (PostEmbedding & {
    post: { slug: string; title: string; projectId: string | null };
    matches: { path: string; score: number }[];
  })[];
}

export async function getEmbeddingSceneRows(
  ownerId: string
): Promise<EmbeddingSceneRows> {
  const [categories, projects, postRows] = await Promise.all([
    prisma.categoryEmbedding.findMany({ orderBy: { path: "asc" } }),
    prisma.projectEmbedding.findMany({
      where: { ownerId },
      include: { project: { select: { title: true } } },
    }),
    prisma.postEmbedding.findMany({
      where: { ownerId },
      include: {
        post: {
          select: {
            slug: true,
            title: true,
            projectId: true,
            categoryMatches: { select: { path: true, score: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const posts = postRows.map(({ post, ...row }) => ({
    ...row,
    post: { slug: post.slug, title: post.title, projectId: post.projectId },
    matches: post.categoryMatches,
  }));
  return { categories, projects, posts };
}

// Owner's posts not yet embedded — drives the backfill script.
export async function listPostsNeedingEmbedding(limit = 50): Promise<
  { id: string; slug: string; title: string; content: string; submittedById: string | null }[]
> {
  return prisma.post.findMany({
    where: { submittedById: { not: null }, embedding: { is: null } },
    select: { id: true, slug: true, title: true, content: true, submittedById: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}
```

Add `PostEmbedding` to the existing type-import at the top of the file (`import { prisma, type CategoryEmbedding, type ProjectEmbedding } from "./index";` → add `type PostEmbedding`).

- [ ] **Step 4: Re-export from `packages/db/src/index.ts`**

Follow the file's existing pattern: re-export the new row types by name (`PostEmbedding`, `PostCategoryMatch`) from the generated client (the repo re-exports model types individually, NOT `export *`), and ensure `export * from "./embeddings"` (already present) picks up the new helpers.

- [ ] **Step 5: Verify + commit**

```bash
bun run check-types && bun run lint
git add packages/db && git commit -m "feat(db): PostEmbedding + PostCategoryMatch linkage + scene read helpers"
```

---

### Task 2: Worker — persist content embeddings + matches; backfill script

**Files:**
- Modify: `apps/worker/src/pipeline/classification/assign-org.ts`
- Create: `apps/worker/scripts/backfill-post-embeddings.ts`

Depends on: Task 1.

- [ ] **Step 1: Persist in `assignOrg` — and loosen the gate**

Today `assignOrg` returns early for scoped ingests, so scoped posts would never appear in the 3D space. Restructure: persistence happens for EVERY user-attributed ingest; only the assignment logic stays gated to unscoped ones.

In `assign-org.ts`, add imports `upsertPostEmbedding`, `replacePostCategoryMatches` to the existing `@repo/db` import. Then replace the guard block at the top of `assignOrg` and add persistence:

```ts
export async function assignOrg(args: AssignOrgArgs): Promise<AssignOrgResult> {
  const { input, postId, classificationInput } = args;
  const ownerId = input.submittedById;
  const config = getClassifyConfig();

  // Bearer ingest (no user) is never embedded or auto-filed.
  if (!config.enabled || ownerId == null) {
    return null;
  }

  const ids = submissionIdsOf(input);
  const dimensionality = getEmbeddingDimensionality();
  const modelVersion = getEmbeddingModel();

  // Make sure existing manual projects are matchable before we compare.
  await ensureProjectEmbeddings(ownerId);

  const contentEmbedding = await embedContent(classificationInput.parts, {
    dimensionality,
  });

  const { categories, bestProject } = await classifyContent({
    ownerId,
    contentEmbedding,
    projectMatchMin: config.projectMatchMin,
    categoryMatchMin: config.categoryMatchMin,
  });

  // Persist the vector + category linkage for EVERY user-attributed ingest so
  // the 3D embedding space covers scoped and unscoped content alike.
  await upsertPostEmbedding({
    postId,
    ownerId,
    retrievalText: classificationInput.prep.retrievalText,
    embedding: contentEmbedding,
    embeddingHash: embeddingHash(queryPrefix(classificationInput.prep.retrievalText)),
    modelVersion,
    dimensionality,
  });
  await replacePostCategoryMatches(
    postId,
    categories.map((c) => ({ path: c.path, score: c.score }))
  );

  // Explicitly-scoped ingests keep their user-chosen Project — no auto-org.
  if (input.projectId != null) {
    return null;
  }

  // ... (rest of the existing match-or-create flow, unchanged)
```

Everything from `if (bestProject) {` down is unchanged.

- [ ] **Step 2: Create `apps/worker/scripts/backfill-post-embeddings.ts`**

Model on `apps/worker/scripts/backfill-project-embeddings.ts` (same env loading / logging style). Full content:

```ts
// Backfill PostEmbedding + PostCategoryMatch for existing user-attributed posts
// that predate persistence. Text-only (staged media is long gone): embeds the
// same queryPrefix(retrievalText) signal the live pipeline uses, built from the
// post's stored title/content. Idempotent: already-embedded posts are skipped
// by the listPostsNeedingEmbedding query. Run: bun run apps/worker/scripts/backfill-post-embeddings.ts
import {
  listPostsNeedingEmbedding,
  replacePostCategoryMatches,
  upsertPostEmbedding,
  classifyContent,
} from "@repo/db";
import {
  getClassifyConfig,
  getEmbeddingDimensionality,
  getEmbeddingModel,
} from "../src/lib/ai-config";
import { embedContent, embeddingHash, queryPrefix } from "../src/lib/embeddings";
import { buildRetrievalText } from "../src/pipeline/classification/prep";

async function main(): Promise<void> {
  const dimensionality = getEmbeddingDimensionality();
  const modelVersion = getEmbeddingModel();
  const config = getClassifyConfig();
  let total = 0;

  for (;;) {
    const batch = await listPostsNeedingEmbedding(25);
    if (batch.length === 0) break;
    for (const post of batch) {
      const retrievalText = buildRetrievalText(post.title, post.content);
      const embedding = await embedContent([{ text: queryPrefix(retrievalText) }], {
        dimensionality,
      });
      await upsertPostEmbedding({
        postId: post.id,
        ownerId: post.submittedById,
        retrievalText,
        embedding,
        embeddingHash: embeddingHash(queryPrefix(retrievalText)),
        modelVersion,
        dimensionality,
      });
      if (post.submittedById) {
        const { categories } = await classifyContent({
          ownerId: post.submittedById,
          contentEmbedding: embedding,
          projectMatchMin: config.projectMatchMin,
          categoryMatchMin: config.categoryMatchMin,
        });
        await replacePostCategoryMatches(
          post.id,
          categories.map((c) => ({ path: c.path, score: c.score }))
        );
      }
      total += 1;
      console.log(`embedded ${post.slug} (${total})`);
    }
  }
  console.log(`backfill complete: ${total} post(s) embedded`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
```

- [ ] **Step 3: Verify + commit**

```bash
bun run check-types && bun run lint
# with DATABASE_URL + GEMINI_API_KEY set:
bun run apps/worker/scripts/backfill-post-embeddings.ts
```
Expected: each pre-existing user post logs one `embedded <slug>` line; re-run prints `backfill complete: 0 post(s) embedded`. Confirm rows in `bun run db:studio` (PostEmbedding, PostCategoryMatch).

```bash
git add apps/worker && git commit -m "feat(worker): persist post embeddings + category linkage; backfill script"
```

---

### Task 3: `@repo/embedding-scene` — shared types, PCA, scene builder

**Files:**
- Create: `packages/embedding-scene/package.json`
- Create: `packages/embedding-scene/tsconfig.json`
- Create: `packages/embedding-scene/eslint.config.mjs`
- Create: `packages/embedding-scene/src/types.ts`
- Create: `packages/embedding-scene/src/pca.ts`
- Create: `packages/embedding-scene/src/build-scene.ts`

Independent of Tasks 1–2 (pure functions; types align by convention).

- [ ] **Step 1: Package scaffolding**

`packages/embedding-scene/package.json`:
```json
{
  "name": "@repo/embedding-scene",
  "version": "0.0.0",
  "private": true,
  "exports": {
    "./react/*": "./src/react/*.tsx",
    "./*": "./src/*.ts"
  },
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "check-types": "tsc --noEmit"
  },
  "devDependencies": {
    "@repo/eslint-config": "*",
    "@repo/typescript-config": "*",
    "@types/node": "^22.15.3",
    "@types/react": "19.2.2",
    "eslint": "^9.39.1",
    "typescript": "~6.0.3"
  },
  "peerDependencies": {
    "@react-three/fiber": "^9.0.0",
    "react": "^19.2.0",
    "three": "^0.182.0"
  }
}
```

`tsconfig.json` and `eslint.config.mjs`: copy from `packages/ui` and adjust (`react-internal` eslint config; tsconfig extends `@repo/typescript-config/react-library.json` — mirror whatever `packages/ui/tsconfig.json` extends). Add `"@repo/embedding-scene": "*"` is NOT needed at root; consumers declare it in Task 4/6/7.

- [ ] **Step 2: `src/types.ts`** — the shared data structure both clients render

```ts
// The wire format for the embedding space. Produced server-side (web API /
// server component), consumed identically by the web and native renderers.
export type SceneNodeKind = "category" | "project" | "post";

export interface SceneNode {
  id: string; // category path | project id | post id
  kind: SceneNodeKind;
  label: string;
  position: [number, number, number];
  // kind-specific extras, all optional so one node shape serves all kinds
  path?: string; // category
  depth?: number; // category
  slug?: string; // post
  projectId?: string | null; // post
}

export type SceneEdgeKind = "taxonomy" | "assignment" | "match";

export interface SceneEdge {
  from: string; // SceneNode.id
  to: string; // SceneNode.id
  kind: SceneEdgeKind;
  weight?: number; // match score for kind === "match"
}

export interface EmbeddingScene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  modelVersion: string;
  dimensionality: number;
  generatedAt: string; // ISO timestamp, set by the producer
}
```

- [ ] **Step 3: `src/pca.ts`** — deterministic PCA → 3D

```ts
// Deterministic top-3 PCA via power iteration with deflation. The covariance
// product is computed as Xᵀ(Xv) so the d×d matrix is never materialized.
// Deterministic init (sin-sequence vectors) keeps positions stable across
// requests for unchanged data — no Math.random.
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n === 0 ? v : v.map((x) => x / n);
}

const POWER_ITERATIONS = 50;
const SCENE_RADIUS = 10;

export function projectTo3d(vectors: number[][]): [number, number, number][] {
  const n = vectors.length;
  if (n === 0) return [];
  const d = vectors[0]!.length;
  if (n === 1) return [[0, 0, 0]];

  const mean = new Array<number>(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i]! += v[i]! / n;
  const X = vectors.map((v) => v.map((x, i) => x - mean[i]!));

  const components: number[][] = [];
  for (let c = 0; c < 3; c++) {
    let v = normalize(Array.from({ length: d }, (_, i) => Math.sin(i + c + 1)));
    for (let iter = 0; iter < POWER_ITERATIONS; iter++) {
      const Xv = X.map((row) => dot(row, v));
      const w = new Array<number>(d).fill(0);
      for (let r = 0; r < n; r++) {
        const s = Xv[r]!;
        const row = X[r]!;
        for (let i = 0; i < d; i++) w[i]! += s * row[i]!;
      }
      for (const p of components) {
        const proj = dot(w, p);
        for (let i = 0; i < d; i++) w[i]! -= proj * p[i]!;
      }
      v = normalize(w);
    }
    components.push(v);
  }

  const points = X.map(
    (row) => components.map((comp) => dot(row, comp)) as [number, number, number]
  );
  let maxAbs = 1e-9;
  for (const p of points) for (const x of p) maxAbs = Math.max(maxAbs, Math.abs(x));
  return points.map(
    (p) => p.map((x) => (x / maxAbs) * SCENE_RADIUS) as [number, number, number]
  );
}
```

- [ ] **Step 4: `src/build-scene.ts`** — rows in, EmbeddingScene out

```ts
// Assemble the scene from raw embedding rows. Pure: no DB, no Date.now — the
// caller supplies generatedAt. Rows whose dimensionality differs from the
// majority are dropped (not comparable; same policy as classify.ts).
import { projectTo3d } from "./pca";
import type { EmbeddingScene, SceneEdge, SceneNode } from "./types";

export interface SceneInputRows {
  categories: {
    path: string;
    name: string;
    parentPath: string | null;
    depth: number;
    embedding: number[];
    dimensionality: number;
  }[];
  projects: {
    projectId: string;
    title: string;
    embedding: number[];
    dimensionality: number;
  }[];
  posts: {
    postId: string;
    slug: string;
    title: string;
    projectId: string | null;
    embedding: number[];
    dimensionality: number;
    matches: { path: string; score: number }[];
  }[];
  modelVersion: string;
  generatedAt: string;
}

export function buildScene(rows: SceneInputRows): EmbeddingScene {
  const dims = [
    ...rows.categories.map((r) => r.dimensionality),
    ...rows.projects.map((r) => r.dimensionality),
    ...rows.posts.map((r) => r.dimensionality),
  ];
  const counts = new Map<number, number>();
  for (const d of dims) counts.set(d, (counts.get(d) ?? 0) + 1);
  let dimensionality = 0;
  for (const [d, c] of counts) {
    if (c > (counts.get(dimensionality) ?? 0)) dimensionality = d;
  }

  const categories = rows.categories.filter((r) => r.dimensionality === dimensionality);
  const projects = rows.projects.filter((r) => r.dimensionality === dimensionality);
  const posts = rows.posts.filter((r) => r.dimensionality === dimensionality);

  const vectors = [
    ...categories.map((r) => r.embedding),
    ...projects.map((r) => r.embedding),
    ...posts.map((r) => r.embedding),
  ];
  const positions = projectTo3d(vectors);

  const nodes: SceneNode[] = [];
  let i = 0;
  for (const c of categories) {
    nodes.push({
      id: c.path,
      kind: "category",
      label: c.name,
      position: positions[i++]!,
      path: c.path,
      depth: c.depth,
    });
  }
  for (const p of projects) {
    nodes.push({
      id: p.projectId,
      kind: "project",
      label: p.title,
      position: positions[i++]!,
    });
  }
  for (const p of posts) {
    nodes.push({
      id: p.postId,
      kind: "post",
      label: p.title,
      position: positions[i++]!,
      slug: p.slug,
      projectId: p.projectId,
    });
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: SceneEdge[] = [];
  for (const c of categories) {
    if (c.parentPath && ids.has(c.parentPath)) {
      edges.push({ from: c.parentPath, to: c.path, kind: "taxonomy" });
    }
  }
  for (const p of posts) {
    if (p.projectId && ids.has(p.projectId)) {
      edges.push({ from: p.postId, to: p.projectId, kind: "assignment" });
    }
    for (const m of p.matches) {
      if (ids.has(m.path)) {
        edges.push({ from: p.postId, to: m.path, kind: "match", weight: m.score });
      }
    }
  }

  return { nodes, edges, modelVersion: rows.modelVersion, dimensionality, generatedAt: rows.generatedAt };
}
```

- [ ] **Step 5: Install + verify + commit**

```bash
bun install
bun run check-types && bun run lint
git add packages/embedding-scene bun.lock && git commit -m "feat(scene): @repo/embedding-scene — shared types, deterministic PCA, scene builder"
```

---

### Task 4: Web API — `GET /api/app/embedding-scene`

**Files:**
- Create: `apps/web/app/api/app/embedding-scene/route.ts`
- Modify: `apps/web/package.json` (add `"@repo/embedding-scene": "*"` to dependencies)

Depends on: Tasks 1 and 3.

- [ ] **Step 1: Route**

`apps/web/app/api/app/embedding-scene/route.ts` (mirrors `projects/route.ts` conventions):

```ts
import { getEmbeddingSceneRows } from "@repo/db";
import { buildScene } from "@repo/embedding-scene/build-scene";

import { getSessionOrNull } from "../../../../lib/session";

export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await getEmbeddingSceneRows(session.user.id);
  const scene = buildScene({
    categories: rows.categories.map((c) => ({
      path: c.path,
      name: c.name,
      parentPath: c.parentPath,
      depth: c.depth,
      embedding: c.embedding,
      dimensionality: c.dimensionality,
    })),
    projects: rows.projects.map((p) => ({
      projectId: p.projectId,
      title: p.project.title,
      embedding: p.embedding,
      dimensionality: p.dimensionality,
    })),
    posts: rows.posts.map((p) => ({
      postId: p.postId,
      slug: p.post.slug,
      title: p.post.title,
      projectId: p.post.projectId,
      embedding: p.embedding,
      dimensionality: p.dimensionality,
      matches: p.matches,
    })),
    modelVersion: rows.categories[0]?.modelVersion ?? "unknown",
    generatedAt: new Date().toISOString(),
  });
  return Response.json(scene);
}
```

- [ ] **Step 2: Verify + commit**

```bash
bun run check-types && bun run lint
```
Manual: with dev server running and a signed-in session, `https://sirius.localhost/api/app/embedding-scene` returns `{ nodes: [...], edges: [...] }` with finite positions (spot-check no `null`/NaN).

```bash
git add apps/web && git commit -m "feat(web): embedding-scene API route"
```

---

### Task 5: Shared R3F scene components (`@repo/embedding-scene/react`)

**Files:**
- Create: `packages/embedding-scene/src/react/space-scene.tsx`
- Create: `packages/embedding-scene/src/react/use-scene-selection.ts`

Depends on: Task 3. (Pure R3F primitives — `<group>`, `<mesh>`, `<lineSegments>` — no DOM, no RN imports, so the SAME components render under both `@react-three/fiber` (web) and `@react-three/fiber/native`.)

- [ ] **Step 1: `src/react/use-scene-selection.ts`**

```ts
// Selection state shared by both hosts. The overlay UI (DOM on web, RN Views on
// mobile) is host-specific; the state shape is not.
import { useMemo, useState } from "react";
import type { EmbeddingScene, SceneNode } from "../types";

export interface SceneSelection {
  selected: SceneNode | null;
  select: (id: string | null) => void;
  // node ids connected to the selected node (for highlight)
  neighborIds: Set<string>;
}

export function useSceneSelection(scene: EmbeddingScene): SceneSelection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const byId = useMemo(
    () => new Map(scene.nodes.map((n) => [n.id, n])),
    [scene.nodes]
  );
  const neighborIds = useMemo(() => {
    const out = new Set<string>();
    if (!selectedId) return out;
    for (const e of scene.edges) {
      if (e.from === selectedId) out.add(e.to);
      if (e.to === selectedId) out.add(e.from);
    }
    return out;
  }, [scene.edges, selectedId]);
  return {
    selected: selectedId ? (byId.get(selectedId) ?? null) : null,
    select: setSelectedId,
    neighborIds,
  };
}
```

- [ ] **Step 2: `src/react/space-scene.tsx`**

```tsx
// Platform-agnostic R3F scene: category/project/post nodes as spheres,
// taxonomy/assignment/match edges as line segments. No DOM, no drei, no
// react-native imports — both hosts mount this inside their own <Canvas>.
import { useMemo } from "react";
import { BufferAttribute, BufferGeometry, Color } from "three";
import type { EmbeddingScene, SceneEdgeKind, SceneNode } from "../types";

const NODE_COLOR: Record<SceneNode["kind"], string> = {
  category: "#8a7bff",
  project: "#ffb84d",
  post: "#5fd4a2",
};

const NODE_RADIUS: Record<SceneNode["kind"], number> = {
  category: 0.14,
  project: 0.22,
  post: 0.1,
};

const EDGE_COLOR: Record<SceneEdgeKind, string> = {
  taxonomy: "#4a4660",
  assignment: "#b3863a",
  match: "#2f6e57",
};

function EdgeLines({
  scene,
  kind,
}: {
  scene: EmbeddingScene;
  kind: SceneEdgeKind;
}) {
  const geometry = useMemo(() => {
    const byId = new Map(scene.nodes.map((n) => [n.id, n.position]));
    const verts: number[] = [];
    for (const e of scene.edges) {
      if (e.kind !== kind) continue;
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      verts.push(...a, ...b);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
    return geo;
  }, [scene, kind]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={new Color(EDGE_COLOR[kind])} transparent opacity={0.45} />
    </lineSegments>
  );
}

export interface SpaceSceneProps {
  scene: EmbeddingScene;
  selectedId: string | null;
  neighborIds: Set<string>;
  onSelect: (id: string | null) => void;
}

export function SpaceScene({ scene, selectedId, neighborIds, onSelect }: SpaceSceneProps) {
  return (
    <group>
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 10, 8]} intensity={0.7} />
      <EdgeLines scene={scene} kind="taxonomy" />
      <EdgeLines scene={scene} kind="assignment" />
      <EdgeLines scene={scene} kind="match" />
      {scene.nodes.map((node) => {
        const active = node.id === selectedId;
        const neighbor = neighborIds.has(node.id);
        return (
          <mesh
            key={node.id}
            position={node.position}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(active ? null : node.id);
            }}
          >
            <sphereGeometry args={[NODE_RADIUS[node.kind] * (active ? 1.8 : 1), 16, 16]} />
            <meshStandardMaterial
              color={NODE_COLOR[node.kind]}
              emissive={active || neighbor ? NODE_COLOR[node.kind] : "#000000"}
              emissiveIntensity={active ? 0.9 : neighbor ? 0.4 : 0}
              transparent
              opacity={selectedId && !active && !neighbor ? 0.25 : 1}
            />
          </mesh>
        );
      })}
    </group>
  );
}
```

Note: R3F's `onClick` works on native too (fiber maps touch events) — no platform fork needed here.

- [ ] **Step 3: Verify + commit**

```bash
bun run check-types && bun run lint
git add packages/embedding-scene && git commit -m "feat(scene): shared R3F SpaceScene + selection hook"
```

---

### Task 6: Web — `/space` page + queue assigned-focus chip

**Files:**
- Create: `apps/web/app/(app)/space/page.tsx`
- Create: `apps/web/app/(app)/space/space-view.tsx`
- Modify: `apps/web/package.json` (deps: `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three`)
- Modify: `apps/web/app/(app)/queue/live.tsx` + its data source (assigned-project chip; see Step 4)

Depends on: Tasks 1, 3, 4, 5.

- [ ] **Step 1: Add deps**

In `apps/web/package.json` dependencies: `"three": "^0.182.0"`, `"@react-three/fiber": "^9.3.0"`, `"@react-three/drei": "^10.7.0"`, `"@repo/embedding-scene": "*"`; devDependencies: `"@types/three": "^0.182.0"`. Then `bun install`.

- [ ] **Step 2: `space/page.tsx`** (server component — reads DB directly, no HTTP hop; the API route from Task 4 exists for mobile)

```tsx
import { getEmbeddingSceneRows } from "@repo/db";
import { buildScene } from "@repo/embedding-scene/build-scene";

import { requireSession } from "../../../lib/session";
import { SpaceView } from "./space-view";

export const dynamic = "force-dynamic";

export default async function SpacePage() {
  const session = await requireSession();
  const rows = await getEmbeddingSceneRows(session.user.id);
  const scene = buildScene({
    categories: rows.categories.map((c) => ({
      path: c.path,
      name: c.name,
      parentPath: c.parentPath,
      depth: c.depth,
      embedding: c.embedding,
      dimensionality: c.dimensionality,
    })),
    projects: rows.projects.map((p) => ({
      projectId: p.projectId,
      title: p.project.title,
      embedding: p.embedding,
      dimensionality: p.dimensionality,
    })),
    posts: rows.posts.map((p) => ({
      postId: p.postId,
      slug: p.post.slug,
      title: p.post.title,
      projectId: p.post.projectId,
      embedding: p.embedding,
      dimensionality: p.dimensionality,
      matches: p.matches,
    })),
    modelVersion: rows.categories[0]?.modelVersion ?? "unknown",
    generatedAt: new Date().toISOString(),
  });
  return <SpaceView scene={scene} />;
}
```

(`requireSession` is exported from `apps/web/lib/session.ts:15` — verified.)

- [ ] **Step 3: `space/space-view.tsx`** (client) — Canvas + taxonomy tree panel + selection overlay

```tsx
"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import { SpaceScene } from "@repo/embedding-scene/react/space-scene";
import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";

// Build the taxonomy tree (category nodes only) for the side panel.
function categoryChildren(scene: EmbeddingScene): Map<string | null, SceneNode[]> {
  const children = new Map<string | null, SceneNode[]>();
  for (const n of scene.nodes) {
    if (n.kind !== "category") continue;
    const parent = n.path?.includes("/")
      ? n.path.slice(0, n.path.lastIndexOf("/"))
      : null;
    const list = children.get(parent) ?? [];
    list.push(n);
    children.set(parent, list);
  }
  return children;
}

function TreeBranch({
  parent,
  childrenMap,
  selectedId,
  onSelect,
}: {
  parent: string | null;
  childrenMap: Map<string | null, SceneNode[]>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const nodes = childrenMap.get(parent) ?? [];
  if (nodes.length === 0) return null;
  return (
    <ul className="ml-3 border-l border-[var(--border,#333)] pl-2">
      {nodes.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onSelect(n.id === selectedId ? null : n.id)}
            className={`block py-0.5 text-left text-[13px] ${
              n.id === selectedId ? "font-semibold underline" : ""
            }`}
          >
            {n.label}
          </button>
          <TreeBranch
            parent={n.path ?? null}
            childrenMap={childrenMap}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

export function SpaceView({ scene }: { scene: EmbeddingScene }) {
  const { selected, select, neighborIds } = useSceneSelection(scene);
  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside className="w-64 shrink-0 overflow-y-auto">
        <h2 className="font-display text-[15px]">Analysis tree</h2>
        <TreeBranch
          parent={null}
          childrenMap={childrenMap}
          selectedId={selected?.id ?? null}
          onSelect={select}
        />
      </aside>
      <div className="relative min-w-0 flex-1">
        <Canvas camera={{ position: [0, 4, 18], fov: 50 }} onPointerMissed={() => select(null)}>
          <SpaceScene
            scene={scene}
            selectedId={selected?.id ?? null}
            neighborIds={neighborIds}
            onSelect={select}
          />
          <OrbitControls enableDamping makeDefault />
        </Canvas>
        {selected ? (
          <div className="absolute bottom-3 left-3 max-w-sm rounded border border-[var(--border,#333)] bg-[var(--bg,#111)]/90 p-3 text-[13px]">
            <span className="uppercase tracking-wide opacity-60">{selected.kind}</span>
            <p className="font-semibold">{selected.label}</p>
            {selected.slug ? (
              <a className="underline" href={`/listing/${selected.slug}`}>
                open post
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

Styling note: match the app's existing editorial tokens — before finalizing, read `apps/web/app/(app)/projects/projects-board.tsx` and reuse its surface/border/text utility classes in place of the `var(--border,#333)` fallbacks above. Add a nav link to `/space` wherever the `(app)` layout/nav lists `queue`/`library` (read `apps/web/app/(app)/layout.tsx` and follow its pattern).

- [ ] **Step 4: Queue chip (UX-review fix — auto-assignment is currently invisible)**

`packages/db/src/ingest.ts` `listSubmissions` already returns `IngestSubmission` rows which now carry `projectId` after auto-org. In the queue UI (`apps/web/app/(app)/queue/live.tsx`), completed rows show `resultPostSlug` via `primaryLabel`. Add a small "filed → <project title>" chip:
1. Extend the queue page's server data load to include a `projectId → title` map (add `listProjectTitles(ownerId): Promise<Record<string, string>>` to `packages/db/src/posts.ts`? No — projects live in their own helper; add to the existing projects helper file and export it: `const rows = await prisma.project.findMany({ where: { ownerId }, select: { id: true, title: true } }); return Object.fromEntries(rows.map(r => [r.id, r.title]))`).
2. Pass the map into the `live.tsx` client component as a prop, and next to the status label for completed rows render:
```tsx
{item.projectId && projectTitles[item.projectId] ? (
  <span className="ml-2 text-[12px] opacity-70">→ {projectTitles[item.projectId]}</span>
) : null}
```
Follow the file's existing class/token style.

- [ ] **Step 5: Verify + commit**

```bash
bun run check-types && bun run lint
```
Manual: `bun run dev`, sign in, visit `https://sirius.localhost/space` — spheres render, orbit works, clicking a node highlights neighbors and shows the overlay; tree panel selects the same nodes. Queue shows `→ <Project>` on auto-filed completed rows.

```bash
git add apps/web packages/db && git commit -m "feat(web): /space 3D embedding view + queue assigned-focus chip"
```

---

### Task 7: Mobile — Space screen (Expo)

**Files:**
- Create: `apps/mobile/src/app/space.tsx`
- Modify: `apps/mobile/package.json` (deps: `three@^0.182.0`, `@react-three/fiber@^9.3.0`, `expo-gl@~56.0.0`, `@repo/embedding-scene": "*"`; devDependency `@types/three@^0.182.0`)

Depends on: Tasks 4 and 5.

- [ ] **Step 1: Install deps**

Add the deps above; for `expo-gl` use `bun --cwd apps/mobile expo install expo-gl` so Expo pins the SDK-56-compatible version. Then `bun install` at root.

- [ ] **Step 2: `apps/mobile/src/app/space.tsx`**

```tsx
// 3D embedding space. Same SpaceScene + selection hook as web; native host
// differs only in Canvas import, camera control (pan-to-orbit), and overlay.
import { Canvas } from "@react-three/fiber/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import type { EmbeddingScene } from "@repo/embedding-scene/types";
import { SpaceScene } from "@repo/embedding-scene/react/space-scene";
import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";

import { apiGet } from "../lib/api";

function OrbitRig({ yaw, pitch }: { yaw: number; pitch: number }) {
  // Camera orbits the origin at fixed radius, driven by pan gestures.
  const radius = 18;
  const x = radius * Math.cos(pitch) * Math.sin(yaw);
  const y = radius * Math.sin(pitch);
  const z = radius * Math.cos(pitch) * Math.cos(yaw);
  return <perspectiveCamera makeDefault position={[x, y, z]} fov={50} onUpdate={(c) => c.lookAt(0, 0, 0)} />;
}

export default function SpaceScreen() {
  const router = useRouter();
  const [scene, setScene] = useState<EmbeddingScene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orbit, setOrbit] = useState({ yaw: 0.6, pitch: 0.35 });
  const orbitRef = useRef(orbit);
  orbitRef.current = orbit;

  useEffect(() => {
    apiGet<EmbeddingScene>("/api/app/embedding-scene")
      .then(setScene)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "failed to load"));
  }, []);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) + Math.abs(g.dy) > 8,
      onPanResponderMove: (_e, g) => {
        const { yaw, pitch } = orbitRef.current;
        setOrbit({
          yaw: yaw + g.vx * 0.05,
          pitch: Math.min(1.4, Math.max(-1.4, pitch + g.vy * 0.05)),
        });
      },
    })
  ).current;

  // Hook needs a scene; render gate first.
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!scene) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading space…</Text>
      </View>
    );
  }
  return <LoadedSpace scene={scene} orbit={orbit} panHandlers={pan.panHandlers} onOpenPost={(slug) => router.push(`/post/${slug}`)} />;
}

function LoadedSpace({
  scene,
  orbit,
  panHandlers,
  onOpenPost,
}: {
  scene: EmbeddingScene;
  orbit: { yaw: number; pitch: number };
  panHandlers: object;
  onOpenPost: (slug: string) => void;
}) {
  const { selected, select, neighborIds } = useSceneSelection(scene);
  const openSelected = useCallback(() => {
    if (selected?.slug) onOpenPost(selected.slug);
  }, [selected, onOpenPost]);
  return (
    <View style={styles.root} {...panHandlers}>
      <Canvas>
        <OrbitRig yaw={orbit.yaw} pitch={orbit.pitch} />
        <SpaceScene
          scene={scene}
          selectedId={selected?.id ?? null}
          neighborIds={neighborIds}
          onSelect={select}
        />
      </Canvas>
      {selected ? (
        <View style={styles.overlay}>
          <Text style={styles.kind}>{selected.kind}</Text>
          <Text style={styles.label}>{selected.label}</Text>
          {selected.slug ? (
            <Pressable onPress={openSelected}>
              <Text style={styles.link}>open post</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0b0f" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: "#888" },
  error: { color: "#e66" },
  overlay: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    borderRadius: 8,
    backgroundColor: "rgba(17,17,22,0.92)",
    padding: 12,
  },
  kind: { color: "#888", fontSize: 11, textTransform: "uppercase" },
  label: { color: "#eee", fontSize: 15, fontWeight: "600" },
  link: { color: "#9bd", marginTop: 6, textDecorationLine: "underline" },
});
```

(`apiGet<T>(path)` is exported from `apps/mobile/src/lib/api.ts:62` — verified.) Add a route entry/link to the screen from the tabs or focus screen following how `focus.tsx` is linked.

- [ ] **Step 3: Verify + commit**

```bash
bun run check-types && bun run lint
bun --cwd apps/mobile ios   # manual: open Space screen in the simulator
```
Expected: scene renders in the simulator (requires `bun run dev:proxy` once per boot + web dev server running), pan orbits, tapping a post sphere shows the overlay; "open post" navigates.

```bash
git add apps/mobile bun.lock && git commit -m "feat(mobile): 3D embedding space screen via fiber/native + expo-gl"
```

---

### Task 8: Smoke script, docs, PR update

**Files:**
- Create: `apps/worker/scripts/smoke-scene.ts`
- Modify: `README.md` (one short section), `.beads/` (br sync)

Depends on: Tasks 1–4 (web/mobile tasks 6–7 only for the manual checklist).

- [ ] **Step 1: `apps/worker/scripts/smoke-scene.ts`**

```ts
// Smoke: assemble the embedding scene for the first owner that has post
// embeddings and assert structural sanity. PASS/FAIL lines for human eyeballs —
// per repo rule, do not claim "tests pass". Run:
//   bun run apps/worker/scripts/smoke-scene.ts
import { getEmbeddingSceneRows, prisma } from "@repo/db";
import { buildScene } from "@repo/embedding-scene/build-scene";

function check(label: string, ok: boolean): boolean {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  return ok;
}

async function main(): Promise<void> {
  const anyPost = await prisma.postEmbedding.findFirst({
    where: { ownerId: { not: null } },
    select: { ownerId: true },
  });
  if (!anyPost?.ownerId) {
    console.log("SKIP  no owner with post embeddings — run backfill-post-embeddings first");
    return;
  }
  const rows = await getEmbeddingSceneRows(anyPost.ownerId);
  const scene = buildScene({
    categories: rows.categories.map((c) => ({
      path: c.path, name: c.name, parentPath: c.parentPath, depth: c.depth,
      embedding: c.embedding, dimensionality: c.dimensionality,
    })),
    projects: rows.projects.map((p) => ({
      projectId: p.projectId, title: p.project.title,
      embedding: p.embedding, dimensionality: p.dimensionality,
    })),
    posts: rows.posts.map((p) => ({
      postId: p.postId, slug: p.post.slug, title: p.post.title,
      projectId: p.post.projectId, embedding: p.embedding,
      dimensionality: p.dimensionality, matches: p.matches,
    })),
    modelVersion: rows.categories[0]?.modelVersion ?? "unknown",
    generatedAt: new Date().toISOString(),
  });

  let ok = true;
  ok = check(`nodes > 0 (${scene.nodes.length})`, scene.nodes.length > 0) && ok;
  ok = check(`edges > 0 (${scene.edges.length})`, scene.edges.length > 0) && ok;
  ok = check(
    "all positions finite",
    scene.nodes.every((n) => n.position.every(Number.isFinite))
  ) && ok;
  ok = check(
    "taxonomy edges connect known nodes",
    scene.edges.every(
      (e) =>
        scene.nodes.some((n) => n.id === e.from) &&
        scene.nodes.some((n) => n.id === e.to)
    )
  ) && ok;
  const spread = new Set(scene.nodes.map((n) => n.position.map((x) => x.toFixed(2)).join(",")));
  ok = check(`positions are spread (unique ${spread.size}/${scene.nodes.length})`, spread.size > scene.nodes.length / 2) && ok;
  if (!ok) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
```

(Add `"@repo/embedding-scene": "*"` to `apps/worker/package.json` dependencies for this script.)

- [ ] **Step 2: README section**

Add a short "Embedding space" subsection under the architecture docs: what persists where (PostEmbedding/PostCategoryMatch/ProjectEmbedding/CategoryEmbedding), the shared `@repo/embedding-scene` package, the `/space` route, the mobile screen, and the two scripts (`backfill-post-embeddings.ts`, `smoke-scene.ts`).

- [ ] **Step 3: Beads + PR**

```bash
br sync --flush-only
git add .beads README.md apps/worker && git commit -m "chore: embedding-space smoke script, docs, beads sync"
git push
```
The branch PR (#2) updates automatically; add a PR comment summarizing the new epic's scope:
```bash
gh pr comment 2 --body "Follow-up epic landed on this branch: 3D embedding space (web /space + mobile Space screen) backed by persisted PostEmbedding/PostCategoryMatch linkage and shared @repo/embedding-scene (deterministic PCA + R3F scene)."
```

---

## Dependency graph (for beads)

```
T1 schema ──► T2 worker persist + backfill
T1 ──► T4 web API ──► T7 mobile screen
T3 shared package ──► T4, T5
T5 shared R3F ──► T6 web page, T7 mobile
T1,T3,T4,T5 ──► T6 (also includes queue chip; touches packages/db projects helper)
T1..T4 ──► T8 smoke/docs/PR
Concurrent-safe starts: T1 and T3 immediately; T2/T4/T5 after their blockers; T6/T7 after T5.
```

## Conflict notes for concurrent agents

- `packages/db/src/embeddings.ts` and `packages/db/src/index.ts` are touched ONLY by T1.
- `packages/embedding-scene/**` is touched by T3 then T5 (T5 blocked by T3 — never concurrent).
- `apps/web/**` only T4 and T6 (T6 blocked by T4).
- `apps/worker/**` only T2 and T8 (T8 blocked by T2 via T1..T4 chain).
- Always reserve files via Agent Mail before editing; release on close.
