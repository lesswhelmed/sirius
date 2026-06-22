// Owner-only "original capture" content for a post: the raw note text typed at
// ingest plus descriptors for any retained audio originals. Web renders the same
// model server-side; this JSON endpoint is what the mobile client fetches. Gated
// on session + ownership exactly like the sibling source/notes routes — originals
// are NEVER exposed beyond the user who submitted them.
import { findPostAttributionBySlug, listSourceSubmissionsForPost } from "@repo/db";
import { buildOriginalContent } from "../../../../../../lib/originals/original-content";
import { getSessionOrNull } from "../../../../../../lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  if (post.submittedById !== session.user.id) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const submissions = await listSourceSubmissionsForPost(post.id);
  const content = buildOriginalContent(slug, submissions);
  return Response.json(content, {
    headers: { "cache-control": "private, no-store" },
  });
}
