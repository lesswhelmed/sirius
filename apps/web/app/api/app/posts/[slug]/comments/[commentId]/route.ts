import {
  findPostAttributionBySlug,
  notifyCommentChanged,
  softDeleteComment,
} from "@repo/db";
import { getSessionOrNull } from "../../../../../../../lib/session";

// DELETE a comment (soft delete → tombstone, so the change rides the delta feed
// to the mobile mirror). Owner-only: softDeleteComment's where-guard requires the
// caller to be both the comment author and the post owner.
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; commentId: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { slug, commentId } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post) {
    return jsonError(404, "not-found");
  }
  if (post.submittedById !== session.user.id) {
    return jsonError(403, "forbidden");
  }

  const ok = await softDeleteComment(commentId, session.user.id);
  if (!ok) {
    return jsonError(404, "not-found");
  }

  void notifyCommentChanged({
    op: "delete",
    commentId,
    postId: post.id,
    ownerId: session.user.id,
    updatedAt: new Date().toISOString(),
  }).catch(() => {});

  return Response.json({ ok: true });
}
