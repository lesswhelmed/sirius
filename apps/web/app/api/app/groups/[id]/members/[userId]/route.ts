import { removeGroupMember } from "@repo/db";
import { getSessionOrNull } from "../../../../../../../lib/session";

// DELETE: remove a member from the owner's group (owner-gated inside the helper;
// a non-owner matches zero rows). Idempotent — removing a non-member still 200s.
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { id, userId } = await params;
  await removeGroupMember(session.user.id, id, userId);
  return Response.json({ ok: true });
}
