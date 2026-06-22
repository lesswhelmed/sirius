// Read/write helpers for the precomputed embedding-scene cache: the kNN
// post↔post neighbors (PostNeighbor), the per-owner force-layout (SceneLayout),
// and the debounced recompute job (SceneRecomputeRequest). The worker computes
// and writes; the scene API reads + assembles. Claim/lease transitions mirror
// archive.ts so the job runs off the same poll loop.
import {
  type PostNeighbor,
  prisma,
  type SceneLayout,
  type SceneRecomputeRequest,
} from "./index";

export type Vec3 = [number, number, number];

// --- PostNeighbor (kNN similarity edges) ---------------------------------

export interface NeighborEdge {
  from: string;
  to: string;
  weight: number;
}

// Replace ALL of an owner's neighbor edges with a freshly computed set, in one
// transaction (delete-then-insert, same shape as replacePostCategoryMatches).
export async function replacePostNeighbors(
  ownerId: string,
  edges: NeighborEdge[],
): Promise<void> {
  await prisma.$transaction([
    prisma.postNeighbor.deleteMany({ where: { ownerId } }),
    prisma.postNeighbor.createMany({
      data: edges.map((e) => ({
        postId: e.from,
        neighborId: e.to,
        score: e.weight,
        ownerId,
      })),
    }),
  ]);
}

// An owner's cached similarity edges as the wire shape the scene assembler
// expects ({ from, to, weight }).
export async function getPostNeighbors(
  ownerId: string,
): Promise<NeighborEdge[]> {
  const rows = await prisma.postNeighbor.findMany({ where: { ownerId } });
  return rows.map((r: PostNeighbor) => ({
    from: r.postId,
    to: r.neighborId,
    weight: r.score,
  }));
}

// --- SceneLayout (cached positions + visual hints) -----------------------

export interface SceneLayoutInput {
  ownerId: string;
  positions: Record<string, Vec3>;
  weights: Record<string, number>;
  clusters: Record<string, string>;
  modelVersion: string;
  dimensionality: number;
  generatedAt: Date;
}

export async function upsertSceneLayout(
  input: SceneLayoutInput,
): Promise<SceneLayout> {
  const { ownerId, ...rest } = input;
  return prisma.sceneLayout.upsert({
    where: { ownerId },
    create: { ownerId, ...rest },
    update: rest,
  });
}

export function getSceneLayout(ownerId: string): Promise<SceneLayout | null> {
  return prisma.sceneLayout.findUnique({ where: { ownerId } });
}

// --- SceneRecomputeRequest (the debounced background job) ----------------

const IN_FLIGHT = ["pending", "processing"] as const;

// Debounced enqueue: if the owner already has an in-flight job, leave it; else
// create one. Called wherever the owner's graph changes (new embedding,
// reclassification, project reassignment, post delete). Best-effort — a failure
// here must never break the originating write, so callers wrap it.
export async function enqueueSceneRecompute(
  userId: string,
): Promise<SceneRecomputeRequest> {
  const existing = await prisma.sceneRecomputeRequest.findFirst({
    where: { userId, status: { in: IN_FLIGHT as unknown as string[] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.sceneRecomputeRequest.create({ data: { userId } });
}

// Optimistic-lock claim, mirroring claimNextArchiveRequest.
export async function claimNextSceneRecompute(): Promise<SceneRecomputeRequest | null> {
  const pending = await prisma.sceneRecomputeRequest.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  if (!pending) return null;
  const claimed = await prisma.sceneRecomputeRequest.updateMany({
    where: { id: pending.id, status: "pending" },
    data: { status: "processing", attempts: { increment: 1 }, startedAt: new Date() },
  });
  if (claimed.count === 0) return null;
  return prisma.sceneRecomputeRequest.findUnique({ where: { id: pending.id } });
}

// Success deletes the row — the output lives in SceneLayout/PostNeighbor, so
// there's nothing to retain and the table stays tiny.
export async function completeSceneRecompute(id: string): Promise<void> {
  await prisma.sceneRecomputeRequest.delete({ where: { id } }).catch(() => {});
}

const MAX_ATTEMPTS = 3;

// Failure: retry by returning the row to `pending` until MAX_ATTEMPTS, then park
// it as `failed` for inspection (won't be re-claimed).
export async function failSceneRecompute(
  id: string,
  errorMessage: string,
): Promise<void> {
  const row = await prisma.sceneRecomputeRequest.findUnique({ where: { id } });
  if (!row) return;
  const giveUp = row.attempts >= MAX_ATTEMPTS;
  await prisma.sceneRecomputeRequest.update({
    where: { id },
    data: {
      status: giveUp ? "failed" : "pending",
      errorMessage: errorMessage.slice(0, 4000),
      completedAt: giveUp ? new Date() : null,
    },
  });
}

// Recover jobs whose worker died mid-run: processing rows older than the lease
// go back to pending. Mirrors the ingest/archive reclaim.
export async function reclaimStaleSceneRecomputes(
  leaseMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - leaseMs);
  const res = await prisma.sceneRecomputeRequest.updateMany({
    where: { status: "processing", startedAt: { lt: cutoff } },
    data: { status: "pending" },
  });
  return res.count;
}
