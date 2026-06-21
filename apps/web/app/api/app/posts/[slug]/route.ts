import {
  deletePostAndSources,
  findPostBySlug,
  PostStatus,
  updatePostContent,
} from "@repo/db";
import { revalidateTag } from "next/cache";
import { removeRetainedForSubmission } from "../../../../../lib/originals/originals-paths";
import { canReadPost } from "../../../../../lib/post-access";
import { updatePostSchema } from "../../../../../lib/posts/schema";
import { getSessionOrNull } from "../../../../../lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const post = await findPostBySlug(slug);
  // Funnel the read decision through canReadPost (the one place the policy
  // lives). Deny with 404, not 403, so a non-owner can't probe which slugs
  // exist. Published posts have a public home at /listing/[slug].
  if (!post || !(await canReadPost(post, session.user.id))) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  return Response.json(post);
}

// Owner-only post-body edit. Updates content/title/excerpt and optionally
// publishes a DRAFT. Ownership is enforced inside updatePostContent (pre-read on
// submittedById); a non-owner is treated as not-found so slug existence can't be
// probed. Revalidates the cached post body + lists (esp. on DRAFT->PUBLISHED).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = updatePostSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "validation failed" }, { status: 400 });
  }

  const result = await updatePostContent({
    slug,
    ownerId: session.user.id,
    content: parsed.data.content,
    title: parsed.data.title,
    excerpt: parsed.data.excerpt,
    status:
      parsed.data.status === "PUBLISHED" ? PostStatus.PUBLISHED : undefined,
  });

  if (!result.ok) {
    if (result.reason === "no-op") {
      // Nothing changed — succeed idempotently without bumping the sync cursor.
      return Response.json({ ok: true, slug, changed: false });
    }
    // not-found AND forbidden both → 404 so a non-owner can't probe existence.
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  revalidateTag(`post-${slug}`, { expire: 0 });
  revalidateTag("posts", { expire: 0 });
  return Response.json({
    ok: true,
    changed: true,
    slug: result.post.slug,
    status: result.post.status,
    lastEdited: result.post.lastEdited,
    updatedAt: result.post.updatedAt,
  });
}

// Owner-only post deletion. Removes the post, its source submissions, and the
// retained original files on disk (retention policy: kept until the user
// deletes). Then invalidates the cached post body + lists.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
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
