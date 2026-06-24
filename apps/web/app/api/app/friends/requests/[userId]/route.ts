import { acceptFriendRequest, declineFriendRequest } from "@repo/db";
import { friendActionSchema } from "../../../../../../lib/friends/schema";
import { getSessionOrNull } from "../../../../../../lib/session";

// POST: accept or decline an incoming pending request from {userId}. Only the
// recipient may act (enforced inside the DB helper's where-guard); a non-matching
// row → 404.
//
// Seeded by: scripts/create-reviewer-account.ts (seedFriends) drives this POST
// over HTTP — each demo friend signs in and accepts the reviewer's pending
// request ({ action: "accept" }) — completing the real request→accept handshake
// that populates the reviewer's Friends list. Keep the contract (200 accepted /
// 404 nothing-pending) in sync with that script's httpAcceptRequest.
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { userId } = await params;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = friendActionSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const ok =
    parsed.data.action === "accept"
      ? await acceptFriendRequest(session.user.id, userId)
      : await declineFriendRequest(session.user.id, userId);
  if (!ok) {
    return jsonError(404, "not-found");
  }
  return Response.json({ ok: true });
}
