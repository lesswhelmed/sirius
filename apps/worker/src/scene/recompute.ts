// Background recompute of an owner's embedding-scene cache. The expensive parts
// (kNN similarity + force layout) run here, off the worker poll loop, and the
// result is persisted so the scene API just reads + assembles. Triggered by a
// SceneRecomputeRequest, enqueued (debounced) whenever the owner's graph changes.
import {
  getEmbeddingSceneRows,
  replacePostNeighbors,
  upsertSceneLayout,
  type Vec3,
} from "@repo/db";
import {
  computeScene,
  sceneInputFromRows,
} from "@repo/embedding-scene/build-scene";

export interface RecomputeResult {
  nodes: number;
  neighbors: number;
}

// Recompute + persist the scene for one owner. Pure-compute is delegated to the
// shared `computeScene`; this just fetches rows, maps, and writes the cache.
export async function recomputeOwnerScene(
  ownerId: string,
): Promise<RecomputeResult> {
  const rows = await getEmbeddingSceneRows(ownerId);
  const scene = computeScene(
    sceneInputFromRows(rows, new Date().toISOString()),
  );

  const positions: Record<string, Vec3> = {};
  const weights: Record<string, number> = {};
  const clusters: Record<string, string> = {};
  for (const n of scene.nodes) {
    positions[n.id] = n.position;
    if (n.weight != null) weights[n.id] = n.weight;
    if (n.clusterId != null) clusters[n.id] = n.clusterId;
  }

  const neighbors = scene.edges
    .filter((e) => e.kind === "similarity")
    .map((e) => ({ from: e.from, to: e.to, weight: e.weight ?? 0 }));

  // Neighbors first, then layout: a reader that catches the in-between state
  // sees stale-but-consistent positions rather than positions referencing edges
  // that don't exist yet.
  await replacePostNeighbors(ownerId, neighbors);
  await upsertSceneLayout({
    ownerId,
    positions,
    weights,
    clusters,
    modelVersion: scene.modelVersion,
    dimensionality: scene.dimensionality,
    generatedAt: new Date(scene.generatedAt),
  });

  return { nodes: scene.nodes.length, neighbors: neighbors.length };
}
