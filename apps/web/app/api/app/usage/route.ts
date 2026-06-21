import { getAiUsage } from "@repo/db";
import { getSessionOrNull } from "../../../../lib/session";

// GET: the signed-in user's weekly AI-generation budget. The device shows this
// (remaining/resetsAt) as a meter; the WORKER is the real enforcer. Pro users
// get null limits (unlimited). Owner-scoped: a user only ever sees their own.
export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const usage = await getAiUsage(session.user.id);
  return Response.json(usage);
}
