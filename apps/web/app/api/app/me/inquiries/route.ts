import { listInquiriesForSeller } from "@repo/db";

import { getSessionOrNull } from "../../../../../lib/session";

export async function GET(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw))) : 50;
  const status = url.searchParams.get("status");
  const result = await listInquiriesForSeller(session.user.id, {
    cursor,
    limit,
    status: status === "closed" ? "closed" : status === "open" ? "open" : undefined,
  });
  return Response.json(result);
}
