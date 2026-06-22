// One-time (idempotent) warm-up of the precomputed scene cache for EXISTING
// data. The scene_precompute migration only creates the empty tables; it does
// not populate them. New activity enqueues a recompute automatically (assign-org
// / delete / project reassign), and the scene API live-computes + enqueues on a
// cold read — so existing users self-heal on first view. This script makes that
// proactive so no first view pays the compute cost: it enqueues a
// SceneRecomputeRequest for every owner that has post embeddings (deduped — a
// no-op if one is already in flight), which the running worker then drains.
//
// Run: bun run apps/worker/scripts/backfill-scene-cache.ts
// Safe to run repeatedly; requires the worker to be running to actually build
// the caches (this only enqueues).
import { enqueueSceneRecompute, prisma } from "@repo/db";

async function main(): Promise<void> {
  const owners = await prisma.postEmbedding.findMany({
    where: { ownerId: { not: null } },
    distinct: ["ownerId"],
    select: { ownerId: true },
  });
  const ids = owners.map((o) => o.ownerId).filter((id): id is string => !!id);
  console.log(`[backfill-scene-cache] ${ids.length} owners with embeddings`);
  let enqueued = 0;
  for (const ownerId of ids) {
    try {
      await enqueueSceneRecompute(ownerId);
      enqueued++;
    } catch (error) {
      console.warn(
        `[backfill-scene-cache] enqueue failed for ${ownerId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(
    `[backfill-scene-cache] enqueued ${enqueued}/${ids.length} recompute jobs — the worker will drain them`,
  );
}

main().finally(() => prisma.$disconnect());
