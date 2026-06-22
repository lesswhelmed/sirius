import { loadOwnerScene } from "../../../lib/scene/load-scene";
import { requireSession } from "../../../lib/session";
import { SpaceView } from "./space-view";

export default async function SpacePage() {
  const session = await requireSession();
  // Reads the worker-precomputed scene cache; computes live only when cold/stale.
  const scene = await loadOwnerScene(session.user.id);
  return <SpaceView scene={scene} />;
}
