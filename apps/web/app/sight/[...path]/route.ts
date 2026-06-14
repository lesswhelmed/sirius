import { resolveSightDir, serveMedia } from "../../../lib/media/serve-media";

// Serves SIGHT image batches written by the worker at runtime to
// SIGHT_IMAGE_DIR (default apps/web/public/sight). See lib/media/serve-media.ts
// for why Next's static handler can't do this. Public on purpose (catalog,
// listings, and mobile fetch these) — placed at the app root, NOT under (app),
// so it is not session-gated. Node runtime for filesystem access.
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path } = await params;
  return serveMedia(resolveSightDir(), path);
}
