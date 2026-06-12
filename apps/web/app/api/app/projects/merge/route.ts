import { mergeProjects } from "@repo/db";

import { getSessionOrNull } from "../../../../../lib/session";
import { projectMergeSchema } from "../../../../../lib/projects/schema";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

// Merge one focus area into another: every post and submission filed under
// `fromId` moves to `toId`, then `fromId` is deleted. Owner-scoped in the DB
// helper.
export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = projectMergeSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const result = await mergeProjects(
    session.user.id,
    parsed.data.fromId,
    parsed.data.toId
  );
  if (!result.ok) {
    const status = result.reason === "not-found" ? 404 : 400;
    return jsonError(status, result.reason);
  }
  return Response.json({
    merged: true,
    movedPosts: result.movedPosts,
    movedSubmissions: result.movedSubmissions,
  });
}
