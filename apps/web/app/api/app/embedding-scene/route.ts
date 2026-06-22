import { loadOwnerScene } from "../../../../lib/scene/load-scene";
import { getSessionOrNull } from "../../../../lib/session";

export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // Cheap read from the precomputed cache (live fallback when cold/stale).
  const scene = await loadOwnerScene(session.user.id);
  return Response.json(scene);
}
