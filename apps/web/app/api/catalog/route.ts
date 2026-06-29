import { listCatalogPosts, publicTierPolicy } from "@repo/db";
import {
  ANONYMOUS_CATALOG_ENABLED,
  PUBLIC_CATALOG_ENABLED,
} from "../../../lib/features";

export async function GET(request: Request) {
  // Anonymous, cross-user feed — gated on the policy's anonymousPublic tier. No
  // public feed while truly-anonymous browsing is off. 404 (not 401/403) so the
  // endpoint's existence isn't advertised. Re-enable via the flag.
  const { anonymousPublic } = publicTierPolicy({
    publicCatalogEnabled: PUBLIC_CATALOG_ENABLED,
    anonymousCatalogEnabled: ANONYMOUS_CATALOG_ENABLED,
  });
  if (!anonymousPublic) {
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
