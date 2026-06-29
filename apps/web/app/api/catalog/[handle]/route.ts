import { listUserStorefront, publicTierPolicy } from "@repo/db";
import {
  ANONYMOUS_CATALOG_ENABLED,
  PUBLIC_CATALOG_ENABLED,
} from "../../../../lib/features";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  // Anonymous storefront feed — gated on the policy's anonymousPublic tier. No
  // public feed while truly-anonymous browsing is off. 404 so the endpoint's
  // existence isn't advertised. Re-enable via the flag.
  const { anonymousPublic } = publicTierPolicy({
    publicCatalogEnabled: PUBLIC_CATALOG_ENABLED,
    anonymousCatalogEnabled: ANONYMOUS_CATALOG_ENABLED,
  });
  if (!anonymousPublic) {
    return new Response("Not found", { status: 404 });
  }

  const { handle } = await params;
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw))) : 50;

  const result = await listUserStorefront(handle, { cursor, limit });
  if (!result) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json(result);
}
