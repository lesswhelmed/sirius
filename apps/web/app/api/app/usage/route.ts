import { countStubPosts, getAiUsage } from "@repo/db";
import { getSessionOrNull } from "../../../../lib/session";

// GET: the signed-in user's weekly AI-generation budget. The device shows this
// (remaining/resetsAt) as a meter; the WORKER is the real enforcer. Pro users
// get null limits (unlimited). Owner-scoped: a user only ever sees their own.
//
// stubCount is ADDITIVE (mobile parses this payload — never reshape the
// existing fields): how many of the user's posts are degraded "bookmark"
// stubs (aiTreatment = "stub") that Pro regeneration could re-roll.
export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const [usage, stubCount] = await Promise.all([
    getAiUsage(session.user.id),
    countStubPosts(session.user.id),
  ]);
  return Response.json({ ...usage, stubCount });
}
