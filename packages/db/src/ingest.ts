// Single source of truth for IngestSubmission state transitions. Shared by the
// HTTP routes (which only call createSubmission) and the worker (which claims,
// marks completed, marks failed). State machine: pending → processing →
// (completed | failed).
import { Prisma } from "../generated/prisma";
import { prisma, type IngestSubmission } from "./index";

export type IngestKind = "url" | "image" | "note";
export type IngestStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "skipped";

const UNIQUE_VIOLATION = "P2002";

export interface CreateSubmissionInput {
  batchId?: string | null;
  contentHash: string;
  imageIndex?: number | null;
  kind: IngestKind;
  payload: Prisma.InputJsonValue;
  stagedFilePath?: string | null;
  totalCount?: number | null;
}

export type CreateSubmissionResult =
  | { status: "created"; submission: IngestSubmission }
  | { status: "deduped"; submission: IngestSubmission };

export async function createSubmission(
  input: CreateSubmissionInput
): Promise<CreateSubmissionResult> {
  try {
    const submission = await prisma.ingestSubmission.create({
      data: {
        kind: input.kind,
        payload: input.payload,
        contentHash: input.contentHash,
        batchId: input.batchId ?? null,
        imageIndex: input.imageIndex ?? null,
        totalCount: input.totalCount ?? null,
        stagedFilePath: input.stagedFilePath ?? null,
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
    where: { status: "pending", kind: { in: ["url", "note"] } },
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
  const candidate = await prisma.ingestSubmission.findFirst({
    where: { status: "pending", kind: "image", batchId: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate?.batchId || candidate.totalCount == null) {
    return [];
  }
  const batchCount = await prisma.ingestSubmission.count({
    where: { batchId: candidate.batchId, kind: "image" },
  });
  if (batchCount < candidate.totalCount) {
    return [];
  }
  const rows = await prisma.ingestSubmission.findMany({
    where: {
      batchId: candidate.batchId,
      kind: "image",
      status: "pending",
    },
    orderBy: { imageIndex: "asc" },
  });
  if (rows.length === 0) {
    return [];
  }
  const claim = await prisma.ingestSubmission.updateMany({
    where: {
      batchId: candidate.batchId,
      kind: "image",
      status: "pending",
    },
    data: {
      status: "processing",
      attempts: { increment: 1 },
      startedAt: new Date(),
    },
  });
  if (claim.count === 0) {
    return [];
  }
  return prisma.ingestSubmission.findMany({
    where: { batchId: candidate.batchId, kind: "image", status: "processing" },
    orderBy: { imageIndex: "asc" },
  });
}

export interface CompletionPatch {
  resultPostSlug?: string | null;
}

export async function markCompleted(
  ids: string[],
  patch: CompletionPatch
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
  errorMessage: string
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
export async function listSubmissions(
  opts: ListSubmissionsOptions = {}
): Promise<PageResult<IngestSubmission>> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const where: Prisma.IngestSubmissionWhereInput = {};
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
    ...(opts.cursor
      ? { cursor: { id: opts.cursor }, skip: 1 }
      : {}),
  });
  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  const last = trimmed[trimmed.length - 1];
  return {
    items: trimmed,
    nextCursor: hasMore && last ? last.id : null,
  };
}
