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
