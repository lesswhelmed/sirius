import {
  createComment,
  findPostAttributionBySlug,
  listCommentsForPost,
  notifyCommentChanged,
} from "@repo/db";
import { commentCreateSchema } from "../../../../../../lib/comments/schema";
import { getSessionOrNull } from "../../../../../../lib/session";

// Comments on a post. Owner-only today: both reading and writing require that the
// signed-in user owns the post (post.submittedById === session.user.id), matching
// the owner-scoped catalog model. Widen here when public/friends visibility lands.
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
  if (!post) {
    return jsonError(404, "not-found");
  }
  if (post.submittedById !== session.user.id) {
    return jsonError(403, "forbidden");
  }
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const page = await listCommentsForPost(post.id, {
    cursor,
    limit: Number.isFinite(limit) ? limit : undefined,
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
  if (!post) {
    return jsonError(404, "not-found");
  }
  if (post.submittedById !== session.user.id) {
    return jsonError(403, "forbidden");
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

  // Best-effort realtime nudge to the owner's connected devices (SSE → delta
  // pull). A notify failure must not fail the write.
  void notifyCommentChanged({
    op: "upsert",
    commentId: comment.id,
    postId: post.id,
    ownerId: session.user.id,
    updatedAt: comment.updatedAt.toISOString(),
  }).catch(() => {});

  return Response.json({ comment }, { status: 201 });
}
