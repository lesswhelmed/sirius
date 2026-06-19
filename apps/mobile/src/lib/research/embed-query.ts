// Query-time embedding for "ask my posts". The device can't embed text on-device
// (the nomic encoder crashed and was dropped — see engine.ts), so the query is
// embedded SERVER-SIDE by the same gemini model that built the post index. The
// returned vector shares the space of the document vectors synced into
// post_vectors, so searchPosts can rank them by cosine directly.
//
// `modelId` is the vector-space tag (e.g. "gemini-embedding-2:768"); it MUST equal
// the embedding_model_id the reconcile step stores post vectors under, or
// allVectors(modelId) matches nothing and search silently returns 0.
import { apiPostJson } from "@/lib/api";

export interface EmbeddedQuery {
  vector: number[];
  modelId: string;
}

interface EmbedQueryResponse {
  vector: number[];
  dim: number;
  modelId: string;
}

// Thrown when the query-embed call fails (offline, auth, or server error). The
// caller surfaces this as "couldn't reach the server" rather than a silent empty
// result — semantic search has no offline fallback by design.
export class EmbedQueryError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EmbedQueryError";
  }
}

// Embed `query` server-side and return its vector + space tag. Trims the query and
// rejects an empty one early (the endpoint would 400 anyway).
export async function embedQuery(
  query: string,
  signal?: AbortSignal,
): Promise<EmbeddedQuery> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new EmbedQueryError("empty query");
  }
  let res: EmbedQueryResponse;
  try {
    res = await apiPostJson<EmbedQueryResponse>(
      "/api/app/research/embed-query",
      { query: trimmed },
      { signal },
    );
  } catch (err) {
    throw new EmbedQueryError("could not reach the server to search", err);
  }
  if (!Array.isArray(res?.vector) || res.vector.length === 0 || !res.modelId) {
    throw new EmbedQueryError("server returned an invalid query embedding");
  }
  return { vector: res.vector, modelId: res.modelId };
}
