import { deleteShareGroup, getShareGroup, updateShareGroup } from "@repo/db";
import { groupUpdateSchema } from "../../../../../lib/groups/schema";
import { agreedOr403, getSessionOrNull } from "../../../../../lib/session";

// One share group: detail (with roster), rename/re-scope, delete. All owner-gated
// inside the @repo/db helpers — a non-owner matches zero rows → 404.
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { id } = await params;
  const group = await getShareGroup(session.user.id, id);
  if (!group) {
    return jsonError(404, "not-found");
  }
  return Response.json({ group });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  // Re-scoping a group can add friends who then see the group's shared posts —
  // UGC exposure, so gate it behind Terms like the group-create + visibility routes.
  const denied = agreedOr403(session);
  if (denied) return denied;
  const { id } = await params;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = groupUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const result = await updateShareGroup(session.user.id, id, parsed.data);
  if (!result.ok) {
    return jsonError(result.reason === "duplicate-name" ? 409 : 404, result.reason);
  }
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { id } = await params;
  const ok = await deleteShareGroup(session.user.id, id);
  if (!ok) {
    return jsonError(404, "not-found");
  }
  return Response.json({ ok: true, deleted: true });
}
