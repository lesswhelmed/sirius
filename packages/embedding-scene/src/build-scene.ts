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
import { projectTo3d } from "./pca";
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

export function buildScene(rows: SceneInputRows): EmbeddingScene {
  // Anchor to the categories' dim so the global taxonomy backbone is never the
  // kind that loses the vote; only fall back to the pooled majority when there
  // are no categories to anchor on.
  const dimensionality =
    rows.categories.length > 0
      ? modeDim(rows.categories.map((r) => r.dimensionality))
      : modeDim([
          ...rows.projects.map((r) => r.dimensionality),
          ...rows.posts.map((r) => r.dimensionality),
        ]);

  const categories = rows.categories.filter((r) => r.dimensionality === dimensionality);
  const projects = rows.projects.filter((r) => r.dimensionality === dimensionality);
  const posts = rows.posts.filter((r) => r.dimensionality === dimensionality);

  // Make dropped rows observable — a silent drop here renders an empty tree
  // that is indistinguishable from "no data" (ao-guc).
  const dropped = {
    category: rows.categories.length - categories.length,
    project: rows.projects.length - projects.length,
    post: rows.posts.length - posts.length,
  };
  if (dropped.category > 0 || dropped.project > 0 || dropped.post > 0) {
    console.warn(
      `[embedding-scene] dropped rows at dim=${dimensionality}: ` +
        `${dropped.category} categories, ${dropped.project} projects, ${dropped.post} posts ` +
        `(dimensionality mismatch — likely a partial embedding backfill or dim migration)`
    );
  }

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
      parentPath: c.parentPath,
      depth: c.depth,
      purpose: c.purpose,
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
