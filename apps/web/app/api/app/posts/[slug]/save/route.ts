import { findPostAttributionBySlug, savePost, unsavePost } from "@repo/db";
import { canReadPost } from "../../../../../../lib/post-access";
import { getSessionOrNull } from "../../../../../../lib/session";

// POST = save, DELETE = unsave. Authenticated-only; idempotent on both sides.
// Read is gated by canReadPost (the single read policy, same as the report /
// comments sibling routes): a non-readable OR non-existent slug returns a
// uniform 404 so a signed-in user can't probe slug existence across the corpus
// or save posts they can't read.
// TODO(cache-components): if a "Saved" list view is cached, call
// updateTag(`saved-${session.user.id}`) here once Phase 6 lands.

async function resolve(
  params: Promise<{ slug: string }>,
): Promise<
  | { ok: true; userId: string; postId: string }
  | { ok: false; response: Response }
> {
  const session = await getSessionOrNull();
  if (!session) {
    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post || !(await canReadPost(post, session.user.id))) {
    return {
      ok: false,
      response: Response.json({ error: "not-found" }, { status: 404 }),
    };
  }
  return { ok: true, userId: session.user.id, postId: post.id };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const r = await resolve(params);
  if (!r.ok) return r.response;
  await savePost(r.userId, r.postId);
  return Response.json({ saved: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const r = await resolve(params);
  if (!r.ok) return r.response;
  await unsavePost(r.userId, r.postId);
  return Response.json({ saved: false });
}
