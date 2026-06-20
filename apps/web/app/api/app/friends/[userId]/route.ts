import { removeFriend } from "@repo/db";
import { getSessionOrNull } from "../../../../../lib/session";

// DELETE: remove an accepted friend, or cancel one's own outgoing request, to
// {userId}. Idempotent — a missing relationship still returns ok.
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { userId } = await params;
  await removeFriend(session.user.id, userId);
  return Response.json({ ok: true });
}
