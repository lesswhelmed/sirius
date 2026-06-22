// Build the owner's EmbeddingScene from db rows. Mirrors apps/web's
// /api/app/embedding-scene route EXACTLY so the MCP taxonomy view can never
// disagree with the web Observatory / mobile Tree. Owner-scoped via
// getEmbeddingSceneRows(ownerId).
import { getEmbeddingSceneRows } from "@repo/db";
import { buildScene } from "@repo/embedding-scene/build-scene";
import type { EmbeddingScene } from "@repo/embedding-scene/types";

export async function buildOwnerScene(ownerId: string): Promise<EmbeddingScene> {
  const rows = await getEmbeddingSceneRows(ownerId);
  return buildScene({
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
    generatedAt: new Date().toISOString(),
  });
}
