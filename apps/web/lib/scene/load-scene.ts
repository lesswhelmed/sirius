// Load an owner's embedding scene the cheap way: read the worker-precomputed
// cache (positions + kNN neighbors) and assemble in O(n). Falls back to a live
// `computeScene` (the expensive PCA/force/kNN path) only when the cache is
// missing or STALE — i.e. some current node has no cached position yet, which
// happens in the brief window after an ingest before the background recompute
// runs — and enqueues a recompute so the next load is cheap again. Best-effort
// by construction: a missing cache is never an error (ao-guc: an empty scene
// must look distinct from "no data" only when there truly is none).
import {
  enqueueSceneRecompute,
  getEmbeddingSceneRows,
  getPostNeighbors,
  getSceneLayout,
} from "@repo/db";
import {
  assembleScene,
  computeScene,
  sceneInputFromRows,
  type SceneRowsSource,
} from "@repo/embedding-scene/build-scene";
import type { EmbeddingScene } from "@repo/embedding-scene/types";

// Every node id the current rows expect, so we can detect a stale cache.
function expectedNodeIds(rows: SceneRowsSource): string[] {
  return [
    ...rows.categories.map((c) => c.path),
    ...rows.projects.map((p) => p.projectId),
    ...rows.posts.map((p) => p.postId),
  ];
}

export async function loadOwnerScene(ownerId: string): Promise<EmbeddingScene> {
  const [rows, layout, neighbors] = await Promise.all([
    getEmbeddingSceneRows(ownerId),
    getSceneLayout(ownerId),
    getPostNeighbors(ownerId),
  ]);
  const input = sceneInputFromRows(rows, new Date().toISOString());

  const positions =
    (layout?.positions as Record<string, [number, number, number]>) ?? null;
  const fresh =
    positions != null &&
    expectedNodeIds(rows).every((id) => positions[id] != null);

  if (fresh) {
    // Stamp generatedAt from the cache so callers can show freshness.
    return assembleScene(
      sceneInputFromRows(rows, layout!.generatedAt.toISOString()),
      positions,
      neighbors,
    );
  }

  // Cold or stale: compute live this once and ask the worker to refresh the
  // cache in the background (deduped). Don't block the response on the enqueue.
  void enqueueSceneRecompute(ownerId).catch(() => {});
  return computeScene(input);
}
