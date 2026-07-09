// Reflection layer: AI-generated questions inviting the post OWNER to write
// their own take on ingested material (the human-written counterpart to the AI
// raw analysis in Post.content), plus the owner's answers.
//
// Visibility: these rows carry NO audience of their own. Every read is gated
// through the parent post (canReadPost in apps/web/lib/post-access.ts), so the
// reflection thread inherits the post's audience exactly — same discipline as
// comments.ts. Writes are owner-only (enforced at the route; helpers here also
// verify the prompt↔post linkage so the denormalized postId can't drift).
//
// Lifecycle: the worker generates one batch of prompts per pipeline run. A
// regeneration REPLACES the active batch — unanswered prompts are tombstoned
// (not hard-deleted, so the delete rides the updatedAt delta feed to mobile
// mirrors, mirroring comments), answered prompts flip to "superseded" so the
// user's writing is never destroyed, and the new batch lands "active".
import { prisma } from "./index";
import type { Prisma } from "../generated/prisma";

export type ReflectionPromptRow = Prisma.ReflectionPromptGetPayload<
  Record<string, never>
>;
export type ReflectionResponseRow = Prisma.ReflectionResponseGetPayload<
  Record<string, never>
>;

export type ReflectionPromptInput = {
  question: string;
  rationale?: string | null;
};

// Replace the post's active prompt batch with a freshly generated one, in one
// transaction. Safe to call on first generation (no prior rows) and on every
// regeneration thereafter. Returns the created rows in display order.
export async function replaceReflectionPrompts(input: {
  postId: string;
  batchId: string;
  prompts: ReflectionPromptInput[];
}): Promise<ReflectionPromptRow[]> {
  const prompts = input.prompts
    .map((p) => ({
      question: p.question.trim(),
      rationale: p.rationale?.trim() || null,
    }))
    .filter((p) => p.question.length > 0);
  return prisma.$transaction(async (tx) => {
    // Prior active prompts WITH a live answer survive read-only.
    await tx.reflectionPrompt.updateMany({
      where: {
        postId: input.postId,
        status: "active",
        response: { is: { status: "active" } },
      },
      data: { status: "superseded" },
    });
    // Everything else active (unanswered, or answer since tombstoned) is
    // tombstoned so the removal propagates through the delta feed.
    await tx.reflectionPrompt.updateMany({
      where: { postId: input.postId, status: "active" },
      data: { status: "tombstone" },
    });
    if (prompts.length === 0) return [];
    await tx.reflectionPrompt.createMany({
      data: prompts.map((p, i) => ({
        postId: input.postId,
        batchId: input.batchId,
        order: i,
        question: p.question,
        rationale: p.rationale,
      })),
    });
    return tx.reflectionPrompt.findMany({
      where: { postId: input.postId, batchId: input.batchId },
      orderBy: { order: "asc" },
    });
  });
}

export type ReflectionThreadItem = ReflectionPromptRow & {
  // Null = unanswered (composer shows for the owner). Tombstoned responses
  // read as unanswered.
  response: ReflectionResponseRow | null;
};

// The post page read: active prompts (in batch order) followed by superseded
// prompts that still carry a live answer (read-only history). Tombstoned
// prompts and prompts whose only answer was deleted are excluded. Callers MUST
// have cleared canReadPost for the post first.
export async function listReflectionForPost(
  postId: string,
): Promise<ReflectionThreadItem[]> {
  const rows = await prisma.reflectionPrompt.findMany({
    where: { postId, status: { in: ["active", "superseded"] } },
    include: { response: true },
    orderBy: [{ createdAt: "asc" }, { order: "asc" }],
  });
  const live = rows
    .map((row) => ({
      ...row,
      response: row.response?.status === "active" ? row.response : null,
    }))
    .filter((row) => row.status === "active" || row.response !== null);
  const active = live.filter((r) => r.status === "active");
  const superseded = live.filter((r) => r.status === "superseded");
  return [...active, ...superseded];
}

// Write (or revive) the owner's answer to a prompt. The unique promptId FK
// means re-answering after a delete updates the same row — status flips back
// to active and updatedAt bumps, so mirrors converge. Verifies the prompt
// belongs to the post and is answerable; the route layer has already verified
// session + post ownership.
export async function upsertReflectionResponse(input: {
  promptId: string;
  postId: string;
  authorId: string;
  body: string;
  audioPath?: string | null;
}): Promise<ReflectionResponseRow | null> {
  const body = input.body.trim();
  if (!body) return null;
  const prompt = await prisma.reflectionPrompt.findUnique({
    where: { id: input.promptId },
    select: { id: true, postId: true, status: true },
  });
  if (!prompt || prompt.postId !== input.postId) return null;
  if (prompt.status === "tombstone") return null;
  return prisma.reflectionResponse.upsert({
    where: { promptId: input.promptId },
    create: {
      promptId: input.promptId,
      postId: input.postId,
      authorId: input.authorId,
      body,
      audioPath: input.audioPath ?? null,
    },
    update: {
      body,
      audioPath: input.audioPath ?? null,
      authorId: input.authorId,
      status: "active",
      deletedAt: null,
    },
  });
}

// Soft delete an answer: tombstone + updatedAt bump so the delete rides the
// delta feed. Author-only (the author is the post owner by construction, but
// encode it in the where so a third party matches zero rows). Returns whether
// a row was actually tombstoned.
export async function tombstoneReflectionResponse(
  responseId: string,
  actorId: string,
): Promise<boolean> {
  const result = await prisma.reflectionResponse.updateMany({
    where: { id: responseId, status: "active", authorId: actorId },
    data: { status: "tombstone", deletedAt: new Date() },
  });
  return result.count > 0;
}

// ---------------------------------------------------------------------------
// Delta feed for the mobile offline mirror — the reflection analogue of
// listCommentsChangedSince. Owner-global (one cursor for all posts), strict
// `gt` watermark, idempotent upsert-by-id reconciliation. Prompts and
// responses ride ONE feed with a single watermark (max updatedAt across both
// tables) so the device can't observe a response before its prompt for long —
// and because reconciliation is idempotent, a duplicate delivery across the
// page boundary is harmless.
// ---------------------------------------------------------------------------
export type ReflectionPromptDelta = {
  id: string;
  postId: string;
  postSlug: string;
  batchId: string;
  order: number;
  question: string;
  rationale: string | null;
  status: "active" | "superseded";
  createdAt: Date;
  updatedAt: Date;
};

export type ReflectionResponseDelta = {
  id: string;
  promptId: string;
  postId: string;
  postSlug: string;
  body: string;
  hasAudio: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ReflectionPromptChange =
  | { op: "upsert"; prompt: ReflectionPromptDelta }
  | { op: "delete"; id: string; deletedAt: string };

export type ReflectionResponseChange =
  | { op: "upsert"; response: ReflectionResponseDelta }
  | { op: "delete"; id: string; deletedAt: string };

export type ReflectionChangesResult = {
  promptChanges: ReflectionPromptChange[];
  responseChanges: ReflectionResponseChange[];
  // ISO of the newest updatedAt in this page across both tables; the client's
  // next `since`. Null only when the page was empty.
  nextCursor: string | null;
  hasMore: boolean;
};

const MAX_PAGE = 200;

export async function listReflectionChangedSince(opts: {
  ownerId: string;
  since: Date;
  limit?: number;
}): Promise<ReflectionChangesResult> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? MAX_PAGE));
  const [promptRows, responseRows] = await Promise.all([
    prisma.reflectionPrompt.findMany({
      where: {
        post: { submittedById: opts.ownerId },
        updatedAt: { gt: opts.since },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: take + 1,
      include: { post: { select: { slug: true } } },
    }),
    prisma.reflectionResponse.findMany({
      where: {
        post: { submittedById: opts.ownerId },
        updatedAt: { gt: opts.since },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: take + 1,
      include: { post: { select: { slug: true } } },
    }),
  ]);
  // Merge both streams by (updatedAt, id) and keep the earliest `take` rows so
  // the single watermark stays correct even when one table dominates the page.
  type Tagged =
    | { kind: "prompt"; row: (typeof promptRows)[number] }
    | { kind: "response"; row: (typeof responseRows)[number] };
  const merged: Tagged[] = [
    ...promptRows.map((row) => ({ kind: "prompt" as const, row })),
    ...responseRows.map((row) => ({ kind: "response" as const, row })),
  ].sort((a, b) => {
    const t = a.row.updatedAt.getTime() - b.row.updatedAt.getTime();
    if (t !== 0) return t;
    return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
  });
  const hasMore = merged.length > take;
  const trimmed = hasMore ? merged.slice(0, take) : merged;

  const promptChanges: ReflectionPromptChange[] = [];
  const responseChanges: ReflectionResponseChange[] = [];
  for (const item of trimmed) {
    if (item.kind === "prompt") {
      const p = item.row;
      if (p.status === "tombstone") {
        promptChanges.push({
          op: "delete",
          id: p.id,
          deletedAt: p.updatedAt.toISOString(),
        });
      } else {
        promptChanges.push({
          op: "upsert",
          prompt: {
            id: p.id,
            postId: p.postId,
            postSlug: p.post.slug,
            batchId: p.batchId,
            order: p.order,
            question: p.question,
            rationale: p.rationale,
            status: p.status === "superseded" ? "superseded" : "active",
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          },
        });
      }
    } else {
      const r = item.row;
      if (r.status === "tombstone") {
        responseChanges.push({
          op: "delete",
          id: r.id,
          deletedAt: r.updatedAt.toISOString(),
        });
      } else {
        responseChanges.push({
          op: "upsert",
          response: {
            id: r.id,
            promptId: r.promptId,
            postId: r.postId,
            postSlug: r.post.slug,
            body: r.body,
            hasAudio: r.audioPath != null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          },
        });
      }
    }
  }
  const last = trimmed[trimmed.length - 1];
  return {
    promptChanges,
    responseChanges,
    nextCursor: last ? last.row.updatedAt.toISOString() : null,
    hasMore,
  };
}
