import { resolveSightDir, serveMedia } from "../../../lib/media/serve-media";

// Serves SIGHT image batches written by the worker at runtime to
// SIGHT_IMAGE_DIR (default apps/web/public/sight). See lib/media/serve-media.ts
// for why Next's static handler can't do this. Public on purpose (catalog,
// listings, and mobile fetch these) — placed at the app root, NOT under (app),
// so it is not session-gated. Route handlers default to the Node.js runtime —
// which serve-media.ts's node:fs access needs — so there is NO `runtime`
// segment export: it is incompatible with this app's Cache Components config.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  return serveMedia(resolveSightDir(), path);
}
