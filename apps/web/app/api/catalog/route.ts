import { listCatalogPosts } from "@repo/db";
import { PUBLIC_CATALOG_ENABLED } from "../../../lib/features";

export async function GET(request: Request) {
  // No public, cross-user feed while the catalog is private. 404 (not 401/403)
  // so the endpoint's existence isn't advertised. Re-enable via the flag.
  if (!PUBLIC_CATALOG_ENABLED) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw))) : 50;

  const result = await listCatalogPosts({ q, cursor, limit });
  return Response.json(result);
}
