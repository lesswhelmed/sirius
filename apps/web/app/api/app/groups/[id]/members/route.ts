import { addGroupMember } from "@repo/db";
import { memberSchema } from "../../../../../../lib/groups/schema";
import { getSessionOrNull } from "../../../../../../lib/session";

// POST: add a member to the owner's group. The target MUST be a current accepted
// friend (enforced in addGroupMember) → 409 not-friend otherwise. Idempotent.
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { id } = await params;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const result = await addGroupMember(session.user.id, id, parsed.data.userId);
  if (!result.ok) {
    return jsonError(result.reason === "group-not-found" ? 404 : 409, result.reason);
  }
  return Response.json({ ok: true });
}
