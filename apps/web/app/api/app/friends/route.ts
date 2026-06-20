import { listFriends } from "@repo/db";
import { getSessionOrNull } from "../../../../lib/session";

// GET: the signed-in user's accepted friends (most-recently-added first).
// Session-authed; the actor is always session.user.id.
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const friends = await listFriends(session.user.id);
  return Response.json({ friends });
}
