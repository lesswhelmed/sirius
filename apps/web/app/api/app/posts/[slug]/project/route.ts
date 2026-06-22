import {
  assignPostToProject,
  enqueueSceneRecompute,
  findPostIdBySlug,
} from "@repo/db";
import { assignSchema } from "../../../../../../lib/projects/schema";
import { getSessionOrNull } from "../../../../../../lib/session";

// PUT = set or clear (projectId: null) the post's Project. Authenticated +
// owner-only (assignPostToProject verifies the post was ingested by the user).
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
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
  const postId = await findPostIdBySlug(slug);
  if (!postId) {
    return jsonError(404, "not-found");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = assignSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const result = await assignPostToProject(
    session.user.id,
    postId,
    parsed.data.projectId,
  );
  if (!result.ok) {
    const status = result.reason === "post-not-found" ? 404 : 409;
    return jsonError(status, result.reason);
  }
  // Assignment edges changed → refresh the cached scene layout (debounced).
  void enqueueSceneRecompute(session.user.id).catch(() => {});
  return Response.json({ projectId: parsed.data.projectId });
}
