import {
  findPostAttributionBySlug,
  notifyCommentChanged,
  softDeleteComment,
} from "@repo/db";
import { canReadPost } from "../../../../../../../lib/post-access";
import { getSessionOrNull } from "../../../../../../../lib/session";

// DELETE a comment (soft delete → tombstone, so the change rides the delta feed
// to the mobile mirror). Allowed for the POST OWNER (moderation) or the COMMENT
// AUTHOR (retract their own) — softDeleteComment's where-guard enforces that.
// The canReadPost gate first ensures the caller can even see the post.
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
  if (!post || !(await canReadPost(post, session.user.id))) {
    return jsonError(404, "not-found");
  }

  // Author-or-owner enforced inside the helper; a third party matches no row.
  const ok = await softDeleteComment(commentId, session.user.id);
  if (!ok) {
    return jsonError(404, "not-found");
  }

  // Notify the POST OWNER's devices (owner-scoped delta feed).
  if (post.submittedById) {
    void notifyCommentChanged({
      op: "delete",
      commentId,
      postId: post.id,
      ownerId: post.submittedById,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  return Response.json({ ok: true });
}
