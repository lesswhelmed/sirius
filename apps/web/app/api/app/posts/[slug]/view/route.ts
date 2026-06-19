import { findPostAttributionBySlug, recordPostView } from "@repo/db";
import { getSessionOrNull } from "../../../../../../lib/session";

// Fire-and-forget view recording, hit by the on-mount client beacon. Session is
// optional (anonymous views allowed). Owner self-views are skipped so authors
// don't inflate their own counts.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post) {
    return new Response(null, { status: 404 });
  }

  const session = await getSessionOrNull();
  const viewerId = session?.user.id ?? null;

  if (viewerId && post.submittedById && viewerId === post.submittedById) {
    return new Response(null, { status: 204 }); // owner view — don't record
  }

  await recordPostView(post.id, viewerId);
  return new Response(null, { status: 204 });
}
