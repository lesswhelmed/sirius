import { findUserByHandle, listPendingRequests, sendFriendRequest } from "@repo/db";
import { friendRequestSchema } from "../../../../../lib/friends/schema";
import { agreedOr403, getSessionOrNull } from "../../../../../lib/session";

// Pending friend requests (incoming + outgoing) and sending a new one.
//
// Seeded by: scripts/create-reviewer-account.ts (seedFriends) drives this POST
// over HTTP — the reviewer signs in and sends a request to each demo friend — so
// the App Store reviewer's Friends list is populated through the real flow rather
// than fabricated friendship rows. Keep this endpoint's contract (POST { handle }
// → 201 sent / 409 already / 404 not-found) in sync with that script's
// httpSendRequest.
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

// GET: both directions, each tagged incoming|outgoing.
export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const requests = await listPendingRequests(session.user.id);
  return Response.json({ requests });
}

// POST: send a friend request to a user identified by handle.
export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const denied = agreedOr403(session);
  if (denied) {
    return denied;
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = friendRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const target = await findUserByHandle(parsed.data.handle);
  if (!target) {
    return jsonError(404, "not-found");
  }
  const result = await sendFriendRequest(session.user.id, target.id);
  if (!result.ok) {
    // self → 400 (bad request); already/blocked → 409 (conflict).
    const status = result.reason === "self" ? 400 : 409;
    return jsonError(status, result.reason);
  }
  return Response.json({ ok: true, status: result.status }, { status: 201 });
}
