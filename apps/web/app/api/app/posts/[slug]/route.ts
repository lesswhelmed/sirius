import { deletePostAndSources, findPostBySlug } from "@repo/db";
import { revalidateTag } from "next/cache";
import { removeRetainedForSubmission } from "../../../../../lib/originals/originals-paths";
import { getSessionOrNull } from "../../../../../lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const post = await findPostBySlug(slug);
  if (!post) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  return Response.json(post);
}

// Owner-only post deletion. Removes the post, its source submissions, and the
// retained original files on disk (retention policy: kept until the user
// deletes). Then invalidates the cached post body + lists.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const result = await deletePostAndSources(slug, session.user.id);
  if (!result.ok) {
    const status = result.reason === "forbidden" ? 403 : 404;
    return Response.json({ error: result.reason }, { status });
  }
  for (const src of result.deletedSources) {
    removeRetainedForSubmission(src.submittedById, src.submissionId);
  }
  revalidateTag("posts", { expire: 0 });
  revalidateTag(`post-${slug}`, { expire: 0 });
  return Response.json({ ok: true });
}
