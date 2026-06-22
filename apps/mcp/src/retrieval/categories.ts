// Taxonomy navigation (swap seam — spec §6). Builds the owner's taxonomy tree +
// per-node post indices from the embedding scene, using the shared
// @repo/embedding-scene queries so the MCP view matches the web Observatory /
// mobile Tree exactly. All reads are owner-scoped (buildOwnerScene).
import {
  categoryChildren,
  type LinkedPost,
  nodeCounts,
  subtreeIndex,
} from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import { listPostsBySlugs } from "@repo/db";

import { type PostSummary, postSummaryWithRelations } from "./summary";
import { buildOwnerScene } from "./scene";

export interface CategoryNode {
  path: string;
  label: string;
  description: string | null;
  depth: number;
  directCount: number;
  subtreeCount: number;
  children: CategoryNode[];
}

// Full owner taxonomy as a nested tree with per-node post counts. Backs
// `list_categories`.
export async function categoryTree(ownerId: string): Promise<CategoryNode[]> {
  const scene = await buildOwnerScene(ownerId);
  const children = categoryChildren(scene);
  const counts = nodeCounts(scene);

  const build = (parent: string | null): CategoryNode[] =>
    (children.get(parent) ?? []).map((n) => ({
      path: n.path ?? n.id,
      label: n.label,
      description: n.purpose ?? null,
      depth: n.depth ?? 0,
      directCount: counts.direct.get(n.id) ?? 0,
      subtreeCount: counts.subtree.get(n.id) ?? 0,
      children: build(n.path ?? n.id),
    }));

  return build(null);
}

export interface CategoryBrowse {
  category: { path: string; label: string; description: string | null };
  items: (PostSummary & { score?: number })[];
  nextCursor: string | null;
}

// Posts under a taxonomy node + its whole subtree (deduped one-per-post). Backs
// `browse_category`. Returns null when the path is not a node in the owner's
// scene (uniform "not found"). Pagination is index-offset over the precomputed
// subtree list (the scene is fully materialized per request).
export async function browseCategory(
  ownerId: string,
  path: string,
  params: { limit?: number; cursor?: string } = {},
): Promise<CategoryBrowse | null> {
  const scene = await buildOwnerScene(ownerId);
  const node = findCategoryByPath(scene, path);
  if (!node) {
    return null;
  }
  const index = subtreeIndex(scene, node.id);
  const flat: LinkedPost[] = index ? index.groups.flatMap((g) => g.posts) : [];

  const limit = Math.min(100, Math.max(1, params.limit ?? 25));
  const start = decodeCursor(params.cursor);
  const slice = flat.slice(start, start + limit);
  const nextCursor =
    start + limit < flat.length ? String(start + limit) : null;

  // Enrich this page's posts with real metadata in one owner-scoped batch query
  // — the scene's LinkedPost nodes only carry slug/label. Slugs come from the
  // owner's scene, so the fetch is owner-safe.
  const full = await listPostsBySlugs(
    ownerId,
    slice.map((lp) => lp.node.slug).filter((s): s is string => Boolean(s)),
  );
  const bySlug = new Map(full.map((p) => [p.slug, p]));

  return {
    category: {
      path: node.path ?? node.id,
      label: node.label,
      description: node.purpose ?? null,
    },
    items: slice.map((lp) => {
      const slug = lp.node.slug ?? "";
      const post = slug ? bySlug.get(slug) : undefined;
      const base: PostSummary = post
        ? postSummaryWithRelations(post)
        : {
            slug,
            title: lp.node.label,
            excerpt: null,
            type: "",
            status: "",
            categories: [],
            tags: [],
            createdAt: "",
          };
      return { ...base, score: lp.weight };
    }),
    nextCursor,
  };
}

function findCategoryByPath(
  scene: EmbeddingScene,
  path: string,
): SceneNode | undefined {
  return scene.nodes.find(
    (n) => n.kind === "category" && (n.path === path || n.id === path),
  );
}

function decodeCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
