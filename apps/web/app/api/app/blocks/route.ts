import { listBlocks } from "@repo/db";
import { getSessionOrNull } from "../../../../lib/session";

// GET: the viewer's own blocked-users list (App Store Guideline 1.2 Part C) —
// feeds the manage-blocks UI in web /settings and the mobile Account screen.
// Only the users THIS viewer blocked; who blocked the viewer is never exposed.
export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const items = await listBlocks(session.user.id);
  return Response.json({ items });
}
