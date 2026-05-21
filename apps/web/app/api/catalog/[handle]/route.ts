import { listUserStorefront } from "@repo/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
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
