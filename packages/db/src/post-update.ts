// Owner-initiated post-body editing. Kept out of posts.ts (query-only by
// convention) because it writes; mirrors post-delete.ts (verify ownership via a
// pre-read, then mutate by id). The web PATCH route and the mobile editor both
// call this. Unlike the worker's upsertPostEmbedding (which bumps ONLY
// updatedAt to preserve lastEdited), a user edit deliberately lets Prisma bump
// BOTH: lastEdited drives the user-facing "Last edited" colophon, updatedAt is
// the mobile delta-sync cursor, and a real edit should advance both.
import { PostStatus } from "../generated/prisma";
import { prisma } from "./index";

export type UpdatePostContentArgs = {
  slug: string;
  ownerId: string; // the trusted session user id
  content?: string;
  title?: string;
  excerpt?: string | null;
  // Only DRAFT -> PUBLISHED is honored (the freemium stub-publish flow); any
  // other transition is ignored. Validate the enum at the route boundary.
  status?: PostStatus;
};

export type UpdatePostContentResult =
  | { ok: false; reason: "not-found" | "forbidden" | "no-op" }
  | {
      ok: true;
      post: {
        slug: string;
        status: PostStatus;
        lastEdited: Date;
        updatedAt: Date;
      };
    };

export async function updatePostContent(
  args: UpdatePostContentArgs,
): Promise<UpdatePostContentResult> {
  const current = await prisma.post.findUnique({
    where: { slug: args.slug },
    select: {
      id: true,
      submittedById: true,
      status: true,
      content: true,
      title: true,
      excerpt: true,
    },
  });
  if (!current) {
    return { ok: false, reason: "not-found" };
  }
  if (current.submittedById !== args.ownerId) {
    return { ok: false, reason: "forbidden" };
  }

  const contentChanged =
    args.content !== undefined && args.content !== current.content;
  const titleChanged =
    args.title !== undefined && args.title !== current.title;
  const excerptChanged =
    args.excerpt !== undefined && args.excerpt !== current.excerpt;
  // Publish is only allowed out of DRAFT. PUBLISHED->anything and ARCHIVED stay
  // the responsibility of dedicated routes, so they're silently not applied.
  const willPublish =
    args.status === PostStatus.PUBLISHED &&
    current.status === PostStatus.DRAFT;

  if (!contentChanged && !titleChanged && !excerptChanged && !willPublish) {
    return { ok: false, reason: "no-op" };
  }

  const data: {
    content?: string;
    title?: string;
    excerpt?: string | null;
    status?: PostStatus;
    published?: boolean;
  } = {};
  if (contentChanged) data.content = args.content;
  if (titleChanged) data.title = args.title;
  if (excerptChanged) data.excerpt = args.excerpt ?? null;
  if (willPublish) {
    data.status = PostStatus.PUBLISHED;
    data.published = true;
  }

  const select = {
    slug: true,
    status: true,
    lastEdited: true,
    updatedAt: true,
  } as const;

  // When the body changed, drop the now-stale embedding in the SAME transaction.
  // The worker's backfill (listPostsNeedingEmbedding: embedding is null) will
  // re-pick it, and the mobile delta carries a null vector (graceful) instead of
  // a wrong one. deleteMany is a no-op when no embedding row exists yet.
  if (contentChanged) {
    const [, post] = await prisma.$transaction([
      prisma.postEmbedding.deleteMany({ where: { postId: current.id } }),
      prisma.post.update({ where: { id: current.id }, data, select }),
    ]);
    return { ok: true, post };
  }

  const post = await prisma.post.update({
    where: { id: current.id },
    data,
    select,
  });
  return { ok: true, post };
}
