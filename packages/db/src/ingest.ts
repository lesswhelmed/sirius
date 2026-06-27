// Single source of truth for IngestSubmission state transitions. Shared by the
// HTTP routes (which only call createSubmission) and the worker (which claims,
// marks completed, marks failed). State machine: pending → processing →
// (completed | failed).
import type { Prisma } from "../generated/prisma";
import { type IngestSubmission, type PostVisibility, prisma } from "./index";

export type IngestKind =
  | "url"
  | "image"
  | "note"
  | "video"
  | "audio"
  | "document";
export type IngestStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "skipped"
  // Terminal, set by the content-safety gate: rejected, no Post created, original
  // quarantined. Never retried; hidden from every user UI.
  | "flagged";

const UNIQUE_VIOLATION = "P2002";

export interface CreateSubmissionInput {
  batchId?: string | null;
  contentHash: string;
  force?: boolean;
  imageIndex?: number | null;
  kind: IngestKind;
  payload: Prisma.InputJsonValue;
  projectId?: string | null;
  stagedFilePath?: string | null;
  submittedById?: string | null;
  totalCount?: number | null;
  // Per-capture read visibility for the resulting Post (composer choice). Null →
  // the worker leaves Post.visibility at its PRIVATE schema default.
  visibility?: PostVisibility | null;
}

export type CreateSubmissionResult =
  | { status: "created"; submission: IngestSubmission }
  | { status: "deduped"; submission: IngestSubmission }
  // A re-submit of content whose prior attempt FAILED. The existing row is
  // requeued (status → pending) so the worker reprocesses it; the re-submit IS
  // the retry. Clients should treat this like "created" (work is now queued),
  // not like a no-op "deduped".
  | { status: "retried"; submission: IngestSubmission };

export async function createSubmission(
  input: CreateSubmissionInput,
): Promise<CreateSubmissionResult> {
  try {
    const submission = await prisma.ingestSubmission.create({
      data: {
        kind: input.kind,
        payload: input.payload,
        contentHash: input.contentHash,
        batchId: input.batchId ?? null,
        imageIndex: input.imageIndex ?? null,
        projectId: input.projectId ?? null,
        totalCount: input.totalCount ?? null,
        stagedFilePath: input.stagedFilePath ?? null,
        submittedById: input.submittedById ?? null,
        visibility: input.visibility ?? null,
        force: input.force ?? false,
      },
    });
    return { status: "created", submission };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      const existing = await prisma.ingestSubmission.findUnique({
        where: { contentHash: input.contentHash },
      });
      if (existing) {
        // Re-submitting content whose previous attempt failed should retry it,
        // not silently return the dead row. Requeue in place: reset the state
        // machine and refresh the payload + freshly staged bytes (the caller
        // re-staged before this call, and a failed image/file may have lost its
        // original staged copy). Guard on status:"failed" so a row that has
        // concurrently moved to processing/completed is never disturbed.
        if (existing.status === "failed") {
          const requeued = await prisma.ingestSubmission.updateMany({
            where: { id: existing.id, status: "failed" },
            data: {
              status: "pending",
              attempts: 0,
              errorMessage: null,
              startedAt: null,
              completedAt: null,
              payload: input.payload,
              stagedFilePath: input.stagedFilePath ?? null,
              // Honor the latest visibility pick on a re-submit of a failed row.
              visibility: input.visibility ?? null,
              force: input.force ?? false,
            },
          });
          if (requeued.count === 1) {
            const refreshed = await prisma.ingestSubmission.findUnique({
              where: { id: existing.id },
            });
            if (refreshed) {
              return { status: "retried", submission: refreshed };
            }
          }
          // Lost the race (status changed under us) — fall through to a fresh
          // read so the caller still gets the current row as a plain dedup.
          const after = await prisma.ingestSubmission.findUnique({
            where: { id: existing.id },
          });
          if (after) {
            return { status: "deduped", submission: after };
          }
        }
        return { status: "deduped", submission: existing };
      }
    }
    throw error;
  }
}

export function findById(id: string): Promise<IngestSubmission | null> {
  return prisma.ingestSubmission.findUnique({ where: { id } });
}

export async function claimNextNonImage(): Promise<IngestSubmission | null> {
  const pending = await prisma.ingestSubmission.findFirst({
    where: {
      status: "pending",
      kind: { in: ["url", "note", "video", "audio", "document"] },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!pending) {
    return null;
  }
  const claimed = await prisma.ingestSubmission.updateMany({
    where: { id: pending.id, status: "pending" },
    data: {
      status: "processing",
      attempts: { increment: 1 },
      startedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    return null;
  }
  return prisma.ingestSubmission.findUnique({ where: { id: pending.id } });
}

export async function claimReadyImageBatch(): Promise<IngestSubmission[]> {
  // Consider every pending image batch oldest-first and claim the first one whose
  // rows are ALL present. An incomplete batch (some uploads never arrived) must
  // NOT block newer, complete batches behind it in the queue — picking only the
  // single oldest row (as before) caused head-of-line blocking: one stuck batch
  // froze all image processing. reclaimStaleImageBatches ages the stuck one out.
  const pending = await prisma.ingestSubmission.findMany({
    where: { status: "pending", kind: "image", batchId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { batchId: true, totalCount: true },
  });
  if (pending.length === 0) {
    return [];
  }
  // Dedupe batchIds preserving oldest-first order.
  const seen = new Set<string>();
  const ordered: { batchId: string; totalCount: number | null }[] = [];
  for (const row of pending) {
    if (row.batchId && !seen.has(row.batchId)) {
      seen.add(row.batchId);
      ordered.push({ batchId: row.batchId, totalCount: row.totalCount });
    }
  }

  for (const { batchId, totalCount } of ordered) {
    if (totalCount == null) {
      continue;
    }
    const batchCount = await prisma.ingestSubmission.count({
      where: { batchId, kind: "image" },
    });
    if (batchCount < totalCount) {
      continue; // not all uploads present yet — try the next batch
    }
    const claim = await prisma.ingestSubmission.updateMany({
      where: { batchId, kind: "image", status: "pending" },
      data: {
        status: "processing",
        attempts: { increment: 1 },
        startedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      continue; // lost the race to another worker; try the next batch
    }
    return prisma.ingestSubmission.findMany({
      where: { batchId, kind: "image", status: "processing" },
      orderBy: { imageIndex: "asc" },
    });
  }
  return [];
}

// Dead-letters image batches that can never complete: some of their uploads
// never arrived and the batch has sat incomplete past the assembly timeout.
// Without this, a partial batch lingers forever (its rows stay pending). Returns
// the number of rows failed.
export async function reclaimStaleImageBatches(
  assemblyTimeoutMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - assemblyTimeoutMs);
  const pending = await prisma.ingestSubmission.findMany({
    where: { status: "pending", kind: "image", batchId: { not: null } },
    select: { batchId: true, totalCount: true, createdAt: true },
  });
  if (pending.length === 0) {
    return 0;
  }
  const byBatch = new Map<
    string,
    { total: number | null; present: number; newest: Date }
  >();
  for (const row of pending) {
    const id = row.batchId as string;
    const cur = byBatch.get(id);
    if (cur) {
      cur.present += 1;
      if (row.createdAt > cur.newest) cur.newest = row.createdAt;
    } else {
      byBatch.set(id, {
        total: row.totalCount,
        present: 1,
        newest: row.createdAt,
      });
    }
  }
  const staleBatchIds: string[] = [];
  for (const [id, info] of byBatch) {
    const incomplete = info.total == null || info.present < info.total;
    if (incomplete && info.newest < cutoff) {
      staleBatchIds.push(id);
    }
  }
  if (staleBatchIds.length === 0) {
    return 0;
  }
  const result = await prisma.ingestSubmission.updateMany({
    where: { batchId: { in: staleBatchIds }, kind: "image", status: "pending" },
    data: {
      status: "failed",
      errorMessage: "incomplete batch: not all uploads arrived before timeout",
      completedAt: new Date(),
    },
  });
  return result.count;
}

export interface CompletionPatch {
  resultPostSlug?: string | null;
  resultPostId?: string | null;
}

export interface RetainedOriginalPatch {
  retainedFilePath: string;
  originalMimeType?: string | null;
  originalSizeBytes?: number | null;
  originalFilename?: string | null;
}

// Records where the worker moved a submission's staged binary so the owner can
// later download it. Called per row after a successful retain (replaces the old
// removeStagedFile delete on the success path).
export async function recordRetainedOriginal(
  id: string,
  patch: RetainedOriginalPatch,
): Promise<void> {
  await prisma.ingestSubmission.update({
    where: { id },
    data: {
      retainedFilePath: patch.retainedFilePath,
      originalMimeType: patch.originalMimeType ?? null,
      originalSizeBytes: patch.originalSizeBytes ?? null,
      originalFilename: patch.originalFilename ?? null,
    },
  });
}

// The retained source originals for a post (1 for url/note/file, N for a SIGHT
// image batch). Only rows that actually have a retained file on disk.
export function listRetainedSourcesForPost(
  postId: string,
): Promise<IngestSubmission[]> {
  return prisma.ingestSubmission.findMany({
    where: { resultPostId: postId, retainedFilePath: { not: null } },
    orderBy: { imageIndex: "asc" },
  });
}

export function countRetainedSourcesForPost(postId: string): Promise<number> {
  return prisma.ingestSubmission.count({
    where: { resultPostId: postId, retainedFilePath: { not: null } },
  });
}

// All source submissions for a post (regardless of retained file) — used to
// synthesize the owner's notes-as-text export from the raw payloads.
export function listSourceSubmissionsForPost(
  postId: string,
): Promise<IngestSubmission[]> {
  return prisma.ingestSubmission.findMany({
    where: { resultPostId: postId },
    orderBy: { imageIndex: "asc" },
  });
}

export async function markCompleted(
  ids: string[],
  patch: CompletionPatch,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await prisma.ingestSubmission.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "completed",
      errorMessage: null,
      completedAt: new Date(),
      ...patch,
    },
  });
}

export async function markFailed(
  ids: string[],
  errorMessage: string,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const truncated = errorMessage.slice(0, 4000);
  await prisma.ingestSubmission.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "failed",
      errorMessage: truncated,
      completedAt: new Date(),
    },
  });
}

// Terminal rejection by the content-safety gate. Distinct from markFailed: NOT
// retryable (the reclaimer never requeues a "flagged" row) and no Post is ever
// created. errorMessage is left null on purpose — the only thing the user ever
// sees is a generic "couldn't be processed"; the real verdict/detail lives in
// the ModerationEvent (recordModerationEvent), never on the submission.
export async function markFlagged(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const now = new Date();
  await prisma.ingestSubmission.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "flagged",
      flaggedAt: now,
      completedAt: now,
      errorMessage: null,
    },
  });
}

export interface RecordModerationEventInput {
  submissionId: string;
  submittedById?: string | null;
  kind: string;
  action: string; // "flag" | "flag_critical"
  severity: string;
  categories: string[];
  rationale?: string | null;
  model: string;
  contentHash?: string | null;
  quarantinePaths?: string[];
  emailedAt?: Date | null;
}

// Writes the CYA audit row for a flagged submission. Kept separate from
// markFlagged so the worker can record the full verdict + quarantine evidence
// even though the submission row itself stays neutral.
export async function recordModerationEvent(
  input: RecordModerationEventInput,
): Promise<void> {
  await prisma.moderationEvent.create({
    data: {
      submissionId: input.submissionId,
      submittedById: input.submittedById ?? null,
      kind: input.kind,
      action: input.action,
      severity: input.severity,
      categories: input.categories,
      rationale: input.rationale ?? null,
      model: input.model,
      contentHash: input.contentHash ?? null,
      quarantinePaths: input.quarantinePaths ?? [],
      emailedAt: input.emailedAt ?? null,
    },
  });
}

// Backfill the Project assignment on submission rows after the worker's auto-org
// stage matches/creates a Project. Mirrors the projectId the worker also writes
// onto the Post, so the queue/submission view reflects the auto-assignment.
export async function setSubmissionProject(
  ids: string[],
  projectId: string | null,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await prisma.ingestSubmission.updateMany({
    where: { id: { in: ids } },
    data: { projectId },
  });
}

// Extends the lease on in-flight rows by bumping startedAt — called
// periodically by the worker during a long job so reclaimStaleProcessing won't
// mistake a still-running job for a crashed one. Scoped to status:"processing"
// so it can't revive a row that was already completed/failed.
export async function heartbeatProcessing(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await prisma.ingestSubmission.updateMany({
    where: { id: { in: ids }, status: "processing" },
    data: { startedAt: new Date() },
  });
}

export interface ReclaimOptions {
  leaseMs: number;
  maxAttempts: number;
}

export interface ReclaimResult {
  requeued: number;
  deadLettered: number;
}

// Recovers rows stranded in "processing" by a worker that was hard-killed
// (SIGKILL, crash, `bun --watch` restart) before marking them completed/failed.
// A row is "stale" once its claim (startedAt) is older than the lease. Stale
// rows that have burned through maxAttempts are dead-lettered to "failed"; the
// rest go back to "pending" to be re-claimed (idempotently re-processed).
export async function reclaimStaleProcessing(
  opts: ReclaimOptions,
): Promise<ReclaimResult> {
  const cutoff = new Date(Date.now() - opts.leaseMs);

  // Dead-letter first so exhausted rows aren't requeued in the same pass.
  const deadLettered = await prisma.ingestSubmission.updateMany({
    where: {
      status: "processing",
      startedAt: { lt: cutoff },
      attempts: { gte: opts.maxAttempts },
    },
    data: {
      status: "failed",
      errorMessage: "reclaimed: exceeded max attempts",
      completedAt: new Date(),
    },
  });

  const requeued = await prisma.ingestSubmission.updateMany({
    where: {
      status: "processing",
      startedAt: { lt: cutoff },
      attempts: { lt: opts.maxAttempts },
    },
    // Leave attempts/startedAt as-is; the next claim re-increments attempts.
    data: { status: "pending" },
  });

  return { requeued: requeued.count, deadLettered: deadLettered.count };
}

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

export interface ListSubmissionsOptions {
  status?: IngestStatus | IngestStatus[];
  kind?: IngestKind | IngestKind[];
  limit?: number;
  cursor?: string;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

// Cursor pagination by (createdAt desc, id). The cursor is just the trailing
// submission id; Prisma's `cursor` + `skip: 1` handles the rest.
//
// `submittedById` is REQUIRED, not optional: this powers the signed-in Queue,
// which must only ever show the caller's own submissions. Making it a required
// positional arg means a caller physically cannot forget to scope (the unscoped
// variant doesn't exist), which is how this surface leaked every user's queue
// before. The worker reads its work via claimNextNonImage/claimReadyImageBatch,
// not this helper, so it is unaffected.
// Owner-dismisses a needs-attention submission from their queue view. Ownership
// (submittedById) + terminal-status guard (failed|skipped only) — a hard delete
// is safe here: failed/skipped rows have no post and already dropped their staged
// bytes (retention is success-only). Returns the deleted count (0 = not owned or
// not in a dismissable status).
export async function dismissSubmission(
  submittedById: string,
  id: string,
): Promise<number> {
  const res = await prisma.ingestSubmission.deleteMany({
    where: { id, submittedById, status: { in: ["failed", "skipped"] } },
  });
  return res.count;
}

export async function listSubmissions(
  submittedById: string,
  opts: ListSubmissionsOptions = {},
): Promise<PageResult<IngestSubmission>> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const where: Prisma.IngestSubmissionWhereInput = { submittedById };
  if (opts.status) {
    where.status = Array.isArray(opts.status)
      ? { in: opts.status }
      : opts.status;
  }
  if (opts.kind) {
    where.kind = Array.isArray(opts.kind) ? { in: opts.kind } : opts.kind;
  }
  const items = await prisma.ingestSubmission.findMany({
    where,
    take: take + 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  const last = trimmed[trimmed.length - 1];
  return {
    items: trimmed,
    nextCursor: hasMore && last ? last.id : null,
  };
}
