import { findPostBySlug } from "@repo/db";
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
