// ArchiveRequest state transitions. A user requests a zip of all their retained
// originals + note text from the web settings page (createArchiveRequest); the
// worker claims it (claimNextArchiveRequest), builds the zip, and marks it ready
// with a download token. State machine: pending → processing → ready | failed,
// plus expired (flipped lazily by the download route once expiresAt passes).
import { prisma, type ArchiveRequest, type IngestSubmission } from "./index";

const IN_FLIGHT = ["pending", "processing"] as const;

// Enqueue a new archive build. To avoid abuse / duplicate work, if the user
// already has an in-flight (pending/processing) request we return that instead
// of creating another.
export async function createArchiveRequest(
  userId: string
): Promise<ArchiveRequest> {
  const existing = await prisma.archiveRequest.findFirst({
    where: { userId, status: { in: IN_FLIGHT as unknown as string[] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return existing;
  }
  return prisma.archiveRequest.create({ data: { userId } });
}

// Optimistic-lock claim, mirroring ingest.claimNextNonImage.
export async function claimNextArchiveRequest(): Promise<ArchiveRequest | null> {
  const pending = await prisma.archiveRequest.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  if (!pending) {
    return null;
  }
  const claimed = await prisma.archiveRequest.updateMany({
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
  return prisma.archiveRequest.findUnique({ where: { id: pending.id } });
}

export interface ArchiveReadyPatch {
  token: string;
  fileCount: number;
  sizeBytes: number;
  downloadPath: string;
  expiresAt: Date;
}

export async function markArchiveReady(
  id: string,
  patch: ArchiveReadyPatch
): Promise<void> {
  await prisma.archiveRequest.update({
    where: { id },
    data: {
      status: "ready",
      errorMessage: null,
      completedAt: new Date(),
      token: patch.token,
      fileCount: patch.fileCount,
      sizeBytes: patch.sizeBytes,
      downloadPath: patch.downloadPath,
      expiresAt: patch.expiresAt,
    },
  });
}

export async function markArchiveFailed(
  id: string,
  errorMessage: string
): Promise<void> {
  await prisma.archiveRequest.update({
    where: { id },
    data: {
      status: "failed",
      errorMessage: errorMessage.slice(0, 4000),
      completedAt: new Date(),
    },
  });
}

export async function markArchiveExpired(id: string): Promise<void> {
  await prisma.archiveRequest.update({
    where: { id },
    data: { status: "expired" },
  });
}

export function listArchiveRequests(
  userId: string,
  limit = 20
): Promise<ArchiveRequest[]> {
  return prisma.archiveRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export function findArchiveByToken(
  token: string
): Promise<ArchiveRequest | null> {
  return prisma.archiveRequest.findUnique({ where: { token } });
}

// Every submission belonging to a user that carries downloadable content: a
// retained binary, or a note/url whose text lives in the payload (synthesized
// into a .md in the zip).
export function listRetainedSubmissionsForUser(
  userId: string
): Promise<IngestSubmission[]> {
  return prisma.ingestSubmission.findMany({
    where: {
      submittedById: userId,
      status: "completed",
      OR: [
        { retainedFilePath: { not: null } },
        { kind: { in: ["note", "url"] } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
}
