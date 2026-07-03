import {
  blockedIdsFor,
  createComment,
  findPostAttributionBySlug,
  listCommentsForPost,
  notifyCommentChanged,
} from "@repo/db";
import { commentCreateSchema } from "../../../../../../lib/comments/schema";
import { canReadPost } from "../../../../../../lib/post-access";
import { getSessionOrNull } from "../../../../../../lib/session";

// Comments on a post. Read AND write are gated by canReadPost (the single read
// policy): anyone who may SEE the post may read its thread and add to it, so
// friends with whom a FRIENDS post is shared can participate. Moderation stays
// owner-scoped (softDeleteComment allows the post owner or the comment author
// only). Realtime nudges always target the POST OWNER (post.submittedById),
// since the comment delta feed is owner-scoped.
//
// No route segment config exports: Next 16 Cache Components rejects `dynamic`.
// Both handlers are already dynamic (they read the session from headers).
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

// GET: list a post's comments (oldest-first), for the web reading view.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post || !(await canReadPost(post, session.user.id))) {
    return jsonError(404, "not-found");
  }
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  // Block-exclusion invariant: on a FRIENDS/GROUP/PUBLIC post a commenter the
  // viewer has blocked (either direction) must not surface in the thread. Thread
  // the viewer's block set through the query like the feed does.
  const blockedIds = await blockedIdsFor(session.user.id);
  const page = await listCommentsForPost(post.id, {
    cursor,
    limit: Number.isFinite(limit) ? limit : undefined,
    blockedIds,
  });
  return Response.json(page);
}

// POST: add a comment. Author is always the signed-in owner (USER kind).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post || !(await canReadPost(post, session.user.id))) {
    return jsonError(404, "not-found");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = commentCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }

  const comment = await createComment({
    postId: post.id,
    authorId: session.user.id,
    body: parsed.data.body,
  });

  // Best-effort realtime nudge to the POST OWNER's connected devices (SSE → delta
  // pull) — the comment delta feed is owner-scoped, so a friend's comment must
  // notify the owner, not the commenter. A notify failure must not fail the write.
  if (post.submittedById) {
    void notifyCommentChanged({
      op: "upsert",
      commentId: comment.id,
      postId: post.id,
      ownerId: post.submittedById,
      updatedAt: comment.updatedAt.toISOString(),
    }).catch(() => {});
  }

  return Response.json({ comment }, { status: 201 });
}
