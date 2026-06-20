import { findUserByHandle, friendshipState } from "@repo/db";
import { getSessionOrNull } from "../../../../../lib/session";

// GET ?q=<handle>: resolve a user by exact handle (a leading @ is stripped) and
// return them with the viewer's current friendship state, so the add-friend box
// can render the right action. Empty result (not an error) when nothing matches
// or the handle is the viewer's own.
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function GET(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const q = (new URL(request.url).searchParams.get("q") ?? "")
    .trim()
    .replace(/^@/, "");
  if (q.length === 0) {
    return Response.json({ results: [] });
  }
  const user = await findUserByHandle(q);
  if (!user || user.id === session.user.id) {
    return Response.json({ results: [] });
  }
  const state = await friendshipState(session.user.id, user.id);
  return Response.json({
    results: [
      {
        id: user.id,
        name: user.name,
        handle: user.handle,
        image: user.image,
        state,
      },
    ],
  });
}
