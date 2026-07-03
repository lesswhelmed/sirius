// UGC moderation (App Store Guideline 1.2): content reports + directional user
// blocks. Follows friends.ts's contract: callers always pass the trusted
// session user id as the actor, and every helper is idempotent where a retry
// (or a duplicate tap) is expected. Visibility enforcement lives in the
// consumers (posts.ts / search.ts / embeddings.ts), all of which AND
// blockedAuthorExclusion() below into their predicate so the legs can't drift.
import { Prisma, ReportStatus } from "../generated/prisma";
import type { ReportReason } from "../generated/prisma";
import { orderPair, shareGroupMemberPurgeOp } from "./friends";
import { prisma } from "./index";

// --- content reports --------------------------------------------------------

// Everything the admin alert email needs: the offending post (slug/title +
// author identity) and who reported it. `satisfies` keeps the literal shape so
// GetPayload infers the exact selection.
const REPORT_INCLUDE = {
  post: {
    select: {
      slug: true,
      title: true,
      submittedById: true,
      submittedBy: {
        select: { id: true, name: true, handle: true, email: true },
      },
    },
  },
  reporter: {
    select: { id: true, name: true, handle: true, email: true },
  },
} satisfies Prisma.ContentReportInclude;

export type ContentReportWithContext = Prisma.ContentReportGetPayload<{
  include: typeof REPORT_INCLUDE;
}>;

// File (or re-file) a report. Upsert on @@unique([postId, reporterId]) makes
// re-reporting idempotent: the row's reason/note refresh but no duplicate
// stacks up. A re-report REOPENS a RESOLVED row — the 24h SLA runs on OPEN
// reports (listOpenReports feeds the moderation CLI), so a fresh complaint
// about previously-cleared content must resurface there; the superseded
// resolution survives in the alert-email trail.
export async function createContentReport(input: {
  postId: string;
  reporterId: string;
  reason: ReportReason;
  note?: string | null;
}): Promise<ContentReportWithContext> {
  return prisma.contentReport.upsert({
    where: {
      postId_reporterId: { postId: input.postId, reporterId: input.reporterId },
    },
    create: {
      postId: input.postId,
      reporterId: input.reporterId,
      reason: input.reason,
      note: input.note ?? null,
    },
    update: {
      reason: input.reason,
      note: input.note ?? null,
      status: ReportStatus.OPEN,
      resolvedAt: null,
      resolvedById: null,
      resolution: null,
    },
    include: REPORT_INCLUDE,
  });
}

// Open reports oldest-first — the 24h clock runs on the oldest one.
export async function listOpenReports(): Promise<ContentReportWithContext[]> {
  return prisma.contentReport.findMany({
    where: { status: ReportStatus.OPEN },
    orderBy: { createdAt: "asc" },
    include: REPORT_INCLUDE,
  });
}

// Close a report. The status guard in the where makes this idempotent (a
// second resolve matches zero rows → false), mirroring the repo's guarded
// updateMany count-check convention.
export async function resolveReport(input: {
  reportId: string;
  resolvedById: string;
  resolution: string;
}): Promise<boolean> {
  const res = await prisma.contentReport.updateMany({
    where: { id: input.reportId, status: ReportStatus.OPEN },
    data: {
      status: ReportStatus.RESOLVED,
      resolvedAt: new Date(),
      resolvedById: input.resolvedById,
      resolution: input.resolution,
    },
  });
  return res.count > 0;
}

// --- user blocks -------------------------------------------------------------

export type BlockResult = { ok: true } | { ok: false; reason: "self" };

// Block a user: create the directional UserBlock (idempotent via upsert), then
// run the same cascade removeFriend does — drop the pair's friendship row and
// purge both parties' memberships in each other's share groups — in ONE
// transaction so a block can never leave a live sharing edge behind. The
// friendship delete is unconditional on status (unlike removeFriend's
// ACCEPTED/own-PENDING guard): a block supersedes a pending request from
// either side and any DECLINED throttle row.
export async function blockUser(input: {
  blockerId: string;
  blockedId: string;
}): Promise<BlockResult> {
  const { blockerId, blockedId } = input;
  if (blockerId === blockedId) return { ok: false, reason: "self" };
  await prisma.$transaction([
    prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    }),
    prisma.friendship.deleteMany({ where: orderPair(blockerId, blockedId) }),
    shareGroupMemberPurgeOp(blockerId, blockedId),
  ]);
  return { ok: true };
}

// Lift a block. Only the blocker's own row is addressable — the other
// direction (them blocking me) is theirs to lift. Idempotent.
export async function unblockUser(input: {
  blockerId: string;
  blockedId: string;
}): Promise<boolean> {
  const res = await prisma.userBlock.deleteMany({
    where: { blockerId: input.blockerId, blockedId: input.blockedId },
  });
  return res.count > 0;
}

export type BlockedUserSummary = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
  blockedAt: Date;
};

// The users THIS user has blocked (their own list — the manage-blocks settings
// UI). Never exposes who blocked the viewer.
export async function listBlocks(
  blockerId: string,
): Promise<BlockedUserSummary[]> {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId },
    orderBy: { createdAt: "desc" },
    include: {
      blocked: { select: { id: true, name: true, handle: true, image: true } },
    },
  });
  return rows.map((r) => ({ ...r.blocked, blockedAt: r.createdAt }));
}

// The exclusion set for visibility queries: UNION of both directions — users I
// blocked AND users who blocked me (bidirectional invisibility is standard).
// Look up once per request at the call site (like friendIdsOf) and thread the
// array through the visibility helpers.
export async function blockedIdsFor(viewerId: string): Promise<string[]> {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.blockerId === viewerId ? r.blockedId : r.blockerId);
  }
  return [...ids];
}

// Does a block exist in either direction? Guards point-reads (friend catalog,
// friend requests) where the full exclusion set is overkill.
export async function isBlockedEither(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const row = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

// The ONE Prisma-side "not by a blocked author" arm, ANDed with each visibility
// predicate (posts.visibilityWhereForViewer, search.searchVisibilityWhere,
// embeddings.listVisiblePostEmbeddings). NULL-safe by construction: Prisma's
// notIn silently drops rows where the column IS NULL (SQL three-valued logic),
// and unattributed posts (bearer-token ingest, submittedById = null) must never
// be swallowed by someone else's block — hence the explicit null arm. The raw
// fullTextLeg mirrors this with `IS NULL OR NOT (= ANY(...))`.
export function blockedAuthorExclusion(
  blockedIds: string[],
): Prisma.PostWhereInput {
  return {
    OR: [{ submittedById: null }, { submittedById: { notIn: blockedIds } }],
  };
}
