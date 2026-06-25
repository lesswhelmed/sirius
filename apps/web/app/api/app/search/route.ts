import { searchCorpus } from "@repo/db";
import { getSessionOrNull } from "../../../../lib/session";

// Curated corpus search (full-text + embedding, RRF-fused) — the UI counterpart
// of the MCP query tools. Session-authed; the viewer id is the ONLY owner the
// search trusts (scope/cursor/limit are the only client inputs). No route segment
// config exports (Next 16 Cache Components rejects `dynamic`/`runtime`); the
// session read already makes this handler dynamic.
//
// scope=all (default) spans the viewer's own posts + friends' shared + public;
// scope=mine restricts to the viewer's own corpus (what the MCP tools do).
export async function GET(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const scope = url.searchParams.get("scope") === "mine" ? "mine" : "all";
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

  // Empty query is a valid no-op, not an error — the UI calls this as the field
  // clears and expects an empty page back.
  if (!q) {
    return Response.json({ items: [], nextCursor: null, partial: false });
  }

  try {
    const page = await searchCorpus(session.user.id, q, { scope, cursor, limit });
    return Response.json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : "search failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
