import { listUserStorefront } from "@repo/db";
import { PUBLIC_CATALOG_ENABLED } from "../../../../lib/features";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  // No public storefront feed while the catalog is private. 404 so the
  // endpoint's existence isn't advertised. Re-enable via the flag.
  if (!PUBLIC_CATALOG_ENABLED) {
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
