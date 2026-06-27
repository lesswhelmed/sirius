import { createShareGroup, listShareGroups } from "@repo/db";
import { groupCreateSchema } from "../../../../lib/groups/schema";
import { getSessionOrNull } from "../../../../lib/session";

// Share groups: named, reusable audiences of the owner's friends. Session-authed;
// the actor is always session.user.id, owner-gated inside the @repo/db helpers.
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

// GET: the signed-in user's groups (name + member count), alphabetical.
export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const groups = await listShareGroups(session.user.id);
  return Response.json({ groups });
}

// POST: create a group, optionally with seed members (non-friends dropped).
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
  const parsed = groupCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const result = await createShareGroup({
    ownerId: session.user.id,
    name: parsed.data.name,
    visibility: parsed.data.visibility,
    memberIds: parsed.data.memberIds,
  });
  if (!result.ok) {
    return jsonError(409, result.reason);
  }
  return Response.json({ ok: true, id: result.id }, { status: 201 });
}
