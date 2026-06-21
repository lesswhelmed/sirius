import { findPostBySlug } from "@repo/db";
import { notFound } from "next/navigation";
import { getSessionOrNull } from "../../../../../lib/session";
import { PostEditor } from "./post-editor";

// Owner-only body editor. A dedicated segment (not inline on the detail page) so
// the editor is a clean client island and the read path stays a cached server
// component. Reads the post fresh (not getCachedPost) so the owner always edits
// the latest. Non-owner / missing → notFound (no existence probing).
export default async function EditPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getSessionOrNull();
  if (!session) {
    notFound();
  }
  const post = await findPostBySlug(slug);
  if (!post || post.submittedById !== session.user.id) {
    notFound();
  }
  return (
    <PostEditor
      slug={post.slug}
      initialTitle={post.title}
      initialExcerpt={post.excerpt ?? ""}
      initialContent={post.content}
      initialStatus={post.status}
      updatedAt={post.updatedAt.toISOString()}
    />
  );
}
