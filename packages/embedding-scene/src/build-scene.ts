// Assemble the scene from raw embedding rows. Pure: no DB, no Date.now — the
// caller supplies generatedAt. Rows whose dimensionality differs from the
// scene dim are dropped (not comparable; same policy as classify.ts).
//
// The scene dim is ANCHORED to the categories' own dim — categories are the
// taxonomy backbone (and are GLOBAL), so they must never be the rows that get
// dropped. Pooling category+project+post dims and voting one majority (the old
// behavior) let owner-scoped posts, which usually outnumber the global
// categories, silently win the vote on any dim drift (model/dim migration,
// partial backfill) and drop EVERY category row → an empty tree that looks
// identical to "no data" (ao-guc). We pick the mode of the CATEGORY dims; only
// when there are no categories do we fall back to the pooled majority. Any
// dropped rows are reported via console.warn with a per-kind count so the
// failure is observable instead of silent.
//
// SPLIT: the expensive work (kNN similarity + force layout) is isolated in
// `computeScene` so the worker can run it in the background and cache the
// result; `assembleScene` is the cheap, O(n) reconstruction the scene-load path
// runs from cached positions + neighbors. `buildScene` === `computeScene` is
// kept as the single-call entry point (and the live fallback when no cache
// exists yet).
import { type NeighborEdge, topKNeighbors } from "./knn";
import { computeLayout, type LayoutEdge, type Vec3 } from "./layout";
import type { EmbeddingScene, SceneEdge, SceneNode } from "./types";

// Most frequent value (mode) of a dimensionality list. Returns 0 for an empty
// list. Ties resolve to the first dim that reached the max count.
function modeDim(dims: number[]): number {
  const counts = new Map<number, number>();
  let best = 0;
  for (const d of dims) {
    const c = (counts.get(d) ?? 0) + 1;
    counts.set(d, c);
    if (c > (counts.get(best) ?? 0)) best = d;
  }
  return best;
}

export interface SceneInputRows {
  categories: {
    path: string;
    name: string;
    parentPath: string | null;
    depth: number;
    purpose?: string;
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

// The shape of `@repo/db`'s `getEmbeddingSceneRows` result, declared
// structurally so this package stays dependency-free. One mapper, shared by the
// worker (precompute) + the web scene API + smoke script, so they can't drift.
export interface SceneRowsSource {
  categories: {
    path: string;
    name: string;
    parentPath: string | null;
    depth: number;
    purpose?: string;
    embedding: number[];
    dimensionality: number;
    modelVersion?: string;
  }[];
  projects: {
    projectId: string;
    project: { title: string };
    embedding: number[];
    dimensionality: number;
  }[];
  posts: {
    postId: string;
    post: { slug: string; title: string; projectId: string | null };
    embedding: number[];
    dimensionality: number;
    matches: { path: string; score: number }[];
  }[];
}

// Flatten DB scene rows into builder input. `generatedAt` is supplied by the
// caller (purity: no Date.now here).
export function sceneInputFromRows(
  rows: SceneRowsSource,
  generatedAt: string,
): SceneInputRows {
  return {
    categories: rows.categories.map((c) => ({
      path: c.path,
      name: c.name,
      parentPath: c.parentPath,
      depth: c.depth,
      purpose: c.purpose,
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
    generatedAt,
  };
}

type FilteredRows = {
  dimensionality: number;
  categories: SceneInputRows["categories"];
  projects: SceneInputRows["projects"];
  posts: SceneInputRows["posts"];
};

// Anchor to the categories' dim and drop comparable-only rows, warning once on
// any drop so a silent collapse (ao-guc) is observable. Shared by both entry
// points so the surviving-row set is always identical.
function filterRows(rows: SceneInputRows): FilteredRows {
  const dimensionality =
    rows.categories.length > 0
      ? modeDim(rows.categories.map((r) => r.dimensionality))
      : modeDim([
          ...rows.projects.map((r) => r.dimensionality),
          ...rows.posts.map((r) => r.dimensionality),
        ]);

  const categories = rows.categories.filter(
    (r) => r.dimensionality === dimensionality,
  );
  const projects = rows.projects.filter(
    (r) => r.dimensionality === dimensionality,
  );
  const posts = rows.posts.filter((r) => r.dimensionality === dimensionality);

  const dropped = {
    category: rows.categories.length - categories.length,
    project: rows.projects.length - projects.length,
    post: rows.posts.length - posts.length,
  };
  if (dropped.category > 0 || dropped.project > 0 || dropped.post > 0) {
    console.warn(
      `[embedding-scene] dropped rows at dim=${dimensionality}: ` +
        `${dropped.category} categories, ${dropped.project} projects, ${dropped.post} posts ` +
        `(dimensionality mismatch — likely a partial embedding backfill or dim migration)`,
    );
  }

  return { dimensionality, categories, projects, posts };
}

// The structural (non-positional) edges every scene has: category parent→child,
// post→project assignment, post→category match. Similarity edges are layered on
// separately because they are the expensive, cached part.
function structuralEdges(filtered: FilteredRows, ids: Set<string>): SceneEdge[] {
  const edges: SceneEdge[] = [];
  for (const c of filtered.categories) {
    if (c.parentPath && ids.has(c.parentPath)) {
      edges.push({ from: c.parentPath, to: c.path, kind: "taxonomy" });
    }
  }
  for (const p of filtered.posts) {
    if (p.projectId && ids.has(p.projectId)) {
      edges.push({ from: p.postId, to: p.projectId, kind: "assignment" });
    }
    for (const m of p.matches) {
      if (ids.has(m.path)) {
        edges.push({ from: p.postId, to: m.path, kind: "match", weight: m.score });
      }
    }
  }
  return edges;
}

// Per-node importance + a post's dominant category, for visual encoding.
// category.weight = # distinct posts that match it; post.weight = its match +
// similarity edge degree; post.clusterId = highest-score matched category that
// survived the dim filter (so a theme shares a hue).
function deriveVisuals(
  filtered: FilteredRows,
  ids: Set<string>,
  similarity: NeighborEdge[],
): { weight: Map<string, number>; cluster: Map<string, string> } {
  const weight = new Map<string, number>();
  const cluster = new Map<string, string>();
  const bump = (id: string) => weight.set(id, (weight.get(id) ?? 0) + 1);

  for (const p of filtered.posts) {
    let best: { path: string; score: number } | null = null;
    for (const m of p.matches) {
      if (!ids.has(m.path)) continue;
      bump(m.path); // category importance
      bump(p.postId); // post degree (match side)
      if (!best || m.score > best.score) best = m;
    }
    if (best) cluster.set(p.postId, best.path);
  }
  for (const e of similarity) {
    bump(e.from);
    bump(e.to);
  }
  return { weight, cluster };
}

// Cheap, O(n) assembly from a position lookup + precomputed similarity edges.
// This is the scene-load path: no PCA, no force relaxation, no kNN.
export function assembleScene(
  rows: SceneInputRows,
  positions: Record<string, Vec3>,
  neighbors: NeighborEdge[],
): EmbeddingScene {
  const filtered = filterRows(rows);
  return assemble(rows, filtered, positions, neighbors);
}

// Expensive, single-call build: derive similarity (kNN) + positions (force
// layout) here, then assemble. Used by the worker (to populate the cache) and
// as the live fallback. Determinism in knn.ts/layout.ts makes the cached output
// reproducible.
export function computeScene(rows: SceneInputRows): EmbeddingScene {
  const filtered = filterRows(rows);
  const ids = new Set<string>([
    ...filtered.categories.map((c) => c.path),
    ...filtered.projects.map((p) => p.projectId),
    ...filtered.posts.map((p) => p.postId),
  ]);

  // Similarity edges from post embeddings (kNN). Posts only.
  const neighbors = topKNeighbors(
    filtered.posts.map((p) => ({ id: p.postId, embedding: p.embedding })),
  );

  // Force layout over ALL nodes, driven by structural + similarity edges.
  const layoutEdges: LayoutEdge[] = [
    ...structuralEdges(filtered, ids),
    ...neighbors.map((e) => ({ from: e.from, to: e.to, kind: "similarity" as const })),
  ];
  const layoutNodes = [
    ...filtered.categories.map((c) => ({
      id: c.path,
      kind: "category" as const,
      embedding: c.embedding,
    })),
    ...filtered.projects.map((p) => ({
      id: p.projectId,
      kind: "project" as const,
      embedding: p.embedding,
    })),
    ...filtered.posts.map((p) => ({
      id: p.postId,
      kind: "post" as const,
      embedding: p.embedding,
    })),
  ];
  const coords = computeLayout(layoutNodes, layoutEdges);
  const positions: Record<string, Vec3> = {};
  layoutNodes.forEach((nd, i) => {
    positions[nd.id] = coords[i] ?? [0, 0, 0];
  });

  return assemble(rows, filtered, positions, neighbors);
}

// Backwards-compatible single entry point (and live fallback). Identical to
// computeScene; kept as the historical name used across the codebase + tests.
export function buildScene(rows: SceneInputRows): EmbeddingScene {
  return computeScene(rows);
}

// Shared assembler: build nodes (with given positions + visual hints) and all
// edges (structural + similarity). Pure.
function assemble(
  rows: SceneInputRows,
  filtered: FilteredRows,
  positions: Record<string, Vec3>,
  neighbors: NeighborEdge[],
): EmbeddingScene {
  const ids = new Set<string>([
    ...filtered.categories.map((c) => c.path),
    ...filtered.projects.map((p) => p.projectId),
    ...filtered.posts.map((p) => p.postId),
  ]);
  // Only keep similarity edges whose endpoints both survived the dim filter.
  const similarity = neighbors.filter((e) => ids.has(e.from) && ids.has(e.to));
  const { weight, cluster } = deriveVisuals(filtered, ids, similarity);
  const posOf = (id: string): Vec3 => positions[id] ?? [0, 0, 0];

  const nodes: SceneNode[] = [];
  for (const c of filtered.categories) {
    nodes.push({
      id: c.path,
      kind: "category",
      label: c.name,
      position: posOf(c.path),
      path: c.path,
      parentPath: c.parentPath,
      depth: c.depth,
      purpose: c.purpose,
      weight: weight.get(c.path) ?? 0,
    });
  }
  for (const p of filtered.projects) {
    nodes.push({
      id: p.projectId,
      kind: "project",
      label: p.title,
      position: posOf(p.projectId),
    });
  }
  for (const p of filtered.posts) {
    nodes.push({
      id: p.postId,
      kind: "post",
      label: p.title,
      position: posOf(p.postId),
      slug: p.slug,
      projectId: p.projectId,
      weight: weight.get(p.postId) ?? 0,
      clusterId: cluster.get(p.postId),
    });
  }

  const edges: SceneEdge[] = structuralEdges(filtered, ids);
  for (const e of similarity) {
    edges.push({ from: e.from, to: e.to, kind: "similarity", weight: e.weight });
  }

  return {
    nodes,
    edges,
    modelVersion: rows.modelVersion,
    dimensionality: filtered.dimensionality,
    generatedAt: rows.generatedAt,
  };
}
