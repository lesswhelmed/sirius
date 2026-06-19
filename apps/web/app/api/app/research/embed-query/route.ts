import { embedContent, embeddingModelTag, queryPrefix } from "@repo/db";
import { getSessionOrNull } from "../../../../../lib/session";

// Query side of mobile "ask my posts". The device used to embed both documents
// and the query with an on-device GGUF; that on-device document indexing was
// removed (it crashed the embedding encoder and was slow). Documents are now the
// worker's gemini-embedding-2 vectors, mirrored to the device via the post-sync
// delta. This endpoint embeds the user's QUERY in that SAME space (same model,
// dimensionality, and queryPrefix the worker uses for post content — symmetric
// retrieval) so the device can cosine-rank the query against its synced vectors.
//
// Session-authed: the vector itself is not user data, but query text is, and we
// don't expose an embedding oracle to anonymous callers.
//
// No route segment config exports: Next 16 Cache Components rejects `dynamic`/
// `runtime`. The handler is already dynamic (reads the session from headers).
export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const query =
    typeof (body as { query?: unknown })?.query === "string"
      ? (body as { query: string }).query.trim()
      : "";
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  try {
    const vector = await embedContent([{ text: queryPrefix(query) }]);
    return Response.json({
      vector,
      dim: vector.length,
      modelId: embeddingModelTag(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "embedding failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
