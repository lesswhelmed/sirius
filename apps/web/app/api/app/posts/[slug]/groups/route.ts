import {
  findPostAttributionBySlug,
  listPostShareGroups,
  setPostShareGroups,
} from "@repo/db";
import { revalidateTag } from "next/cache";
import { postGroupsSchema } from "../../../../../../lib/groups/schema";
import { getSessionOrNull } from "../../../../../../lib/session";

// The share groups a post is shared with. Owner-only: a recipient never
// enumerates a post's groups (PRIVATE-by-default group identity). PUT replaces the
// set AND flips visibility=GROUP in one transaction (setPostShareGroups).
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  // Owner-gate: non-owner (or missing) → 404, no existence probing.
  if (!post || post.submittedById !== session.user.id) {
    return jsonError(404, "not-found");
  }
  const groups = await listPostShareGroups(session.user.id, post.id);
  return Response.json({ groups });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post || post.submittedById !== session.user.id) {
    return jsonError(404, "not-found");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = postGroupsSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const result = await setPostShareGroups(
    session.user.id,
    post.id,
    parsed.data.groupIds,
  );
  if (!result.ok) {
    return jsonError(result.reason === "invalid-group" ? 409 : 404, result.reason);
  }
  revalidateTag(`post-${slug}`, { expire: 0 });
  return Response.json({ ok: true, groupIds: result.groupIds });
}
