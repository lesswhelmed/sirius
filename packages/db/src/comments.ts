// Comments on posts. Owner-scoped today (only the post owner comments on their
// own posts), but the shape is agent-ready: a comment can be authored by a human
// (authorKind=USER, authorId set) or — later — an AI responder (authorKind=AGENT,
// authorId null + agentName label). Writes live here; the delta feed mirrors
// posts.ts:listPostsChangedSince so the mobile offline mirror reconciles comments
// the same way it reconciles posts.
import { type CommentAuthorKind, Prisma } from "../generated/prisma";
import { type Comment, prisma } from "./index";
import type { PageResult } from "./ingest";

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

// The author fields the UI needs to render a byline. Null for AGENT comments and
// for comments whose human author later deleted their account (FK SetNull).
export type CommentAuthorSummary = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
};

export type CommentWithAuthor = Comment & {
  author: CommentAuthorSummary | null;
};

const AUTHOR_SELECT = {
  select: { id: true, name: true, handle: true, image: true },
} as const;

// Create a human (USER) comment. authorKind/agentName default appropriately;
// AGENT comments are a future path written through a separate entrypoint.
export async function createComment(input: {
  postId: string;
  authorId: string;
  body: string;
}): Promise<CommentWithAuthor> {
  return prisma.comment.create({
    data: {
      postId: input.postId,
      authorId: input.authorId,
      body: input.body,
      authorKind: "USER",
    },
    include: { author: AUTHOR_SELECT },
  });
}

// Ascending (oldest-first) cursor list for a single post — the web reading view
// renders a conversation, so chronological order reads naturally. Tombstoned
// rows are excluded.
//
// Block-exclusion invariant: pass the viewer's blocked-id set (moderation
// .blockedIdsFor — both directions) so comments authored by a blocked user are
// hidden, mirroring how posts.visibilityWhereForViewer ANDs
// blockedAuthorExclusion. Defaults empty so an owner-only / unauthenticated
// caller with no viewer context sees the full thread unchanged. NULL-safe like
// the Post arm: AGENT comments (authorId null) and comments whose human author
// deleted their account (FK SetNull) must never be swallowed by someone's block.
export async function listCommentsForPost(
  postId: string,
  opts: { limit?: number; cursor?: string; blockedIds?: string[] } = {},
): Promise<PageResult<CommentWithAuthor>> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const blockedIds = opts.blockedIds ?? [];
  const where: Prisma.CommentWhereInput = {
    postId,
    status: "active",
    ...(blockedIds.length > 0
      ? { OR: [{ authorId: null }, { authorId: { notIn: blockedIds } }] }
      : {}),
  };
  const items = await prisma.comment.findMany({
    where,
    take: take + 1,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { author: AUTHOR_SELECT },
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  const last = trimmed[trimmed.length - 1];
  return { items: trimmed, nextCursor: hasMore && last ? last.id : null };
}

// ---------------------------------------------------------------------------
// Delta feed for the mobile offline mirror — the comment analogue of
// listPostsChangedSince. Owner-global: returns every comment on ANY of the
// owner's posts changed since the watermark, so one cursor drives all threads
// (no per-post channel). Tombstones come back as deletes. postSlug is carried so
// the device can attach each comment to the right local post row.
// ---------------------------------------------------------------------------
export type CommentDelta = {
  id: string;
  postId: string;
  postSlug: string;
  authorKind: CommentAuthorKind;
  authorId: string | null;
  // Resolved display label: the human's handle/name, or the agentName for AGENT
  // comments. The device stores it denormalized (it has no user mirror).
  authorLabel: string | null;
  authorImage: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CommentChange =
  | { op: "upsert"; comment: CommentDelta }
  | { op: "delete"; id: string; deletedAt: string };

export type CommentChangesResult = {
  changes: CommentChange[];
  // ISO of the newest updatedAt in this page; the client's next `since`. Null
  // only when the page was empty (client keeps its existing watermark).
  nextCursor: string | null;
  hasMore: boolean;
};

export async function listCommentsChangedSince(opts: {
  ownerId: string;
  since: Date;
  limit?: number;
}): Promise<CommentChangesResult> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? MAX_PAGE));
  // Scope to comments on the owner's own posts. Strict `gt` + (updatedAt, id)
  // ordering; reconciliation is an idempotent upsert-by-id so a duplicate
  // delivery across a page boundary is harmless.
  const rows = await prisma.comment.findMany({
    where: {
      post: { submittedById: opts.ownerId },
      updatedAt: { gt: opts.since },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: take + 1,
    include: {
      post: { select: { slug: true } },
      author: AUTHOR_SELECT,
    },
  });
  const hasMore = rows.length > take;
  const trimmed = hasMore ? rows.slice(0, take) : rows;
  const changes: CommentChange[] = trimmed.map((c) =>
    c.status === "tombstone"
      ? { op: "delete", id: c.id, deletedAt: c.updatedAt.toISOString() }
      : {
          op: "upsert",
          comment: {
            id: c.id,
            postId: c.postId,
            postSlug: c.post.slug,
            authorKind: c.authorKind,
            authorId: c.authorId,
            authorLabel:
              c.authorKind === "AGENT"
                ? c.agentName
                : (c.author?.handle ?? c.author?.name ?? null),
            authorImage: c.author?.image ?? null,
            body: c.body,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
          },
        },
  );
  const last = trimmed[trimmed.length - 1];
  return {
    changes,
    nextCursor: last ? last.updatedAt.toISOString() : null,
    hasMore,
  };
}

// Soft delete: flips status to "tombstone" and bumps updatedAt so the change
// rides the delta feed to every mirror. Allowed for the POST OWNER (moderates the
// whole thread, incl. a future AGENT comment) OR the COMMENT AUTHOR (deletes
// their own) — both encoded in the updateMany where so a third party matches zero
// rows. With friends sharing, a friend who commented can retract their comment
// without granting them moderation over others'. Returns whether a row was
// actually tombstoned.
export async function softDeleteComment(
  commentId: string,
  actorId: string,
): Promise<boolean> {
  const result = await prisma.comment.updateMany({
    where: {
      id: commentId,
      status: "active",
      OR: [{ post: { submittedById: actorId } }, { authorId: actorId }],
    },
    data: { status: "tombstone", deletedAt: new Date() },
  });
  return result.count > 0;
}
