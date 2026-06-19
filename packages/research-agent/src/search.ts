// The heart of the feature: turn a natural-language query into the user's most
// relevant posts. Embeds the query on-device with the SAME model that built the
// index (so the vectors share a space), then ranks every stored post vector by
// cosine similarity. Brute-force is intentional and fine — a single dot product
// per post over hundreds of owner-scoped posts is low-single-digit milliseconds,
// and it keeps the vector store a dumb blob CRUD (see ports.ts).
import { embed } from "ai";

import { cosineSim } from "./cosine";
import type { ScoredPost, SearchPorts } from "./ports";

export interface SearchOptions {
  // Max posts to return. Default 6 — enough to ground an answer, few enough to fit
  // a small on-device model's context.
  topK?: number;
  // Drop matches below this cosine score so a query with no real match returns
  // nothing (and the model says "I don't know") instead of citing noise.
  minScore?: number;
  // Prefix prepended to the query before embedding, for models trained with
  // asymmetric task instructions (e.g. nomic-embed's "search_query: "). Must pair
  // with the document-side prefix used when the index was built. Empty by default.
  // Ignored when `queryVector` is supplied (the host already embedded the query).
  queryPrefix?: string;
  // A precomputed query vector. When provided, the query is NOT embedded here
  // (ports.embeddingModel is not used) — the host embedded it elsewhere, e.g. the
  // mobile client embeds the query server-side in the same space as the synced
  // document vectors. Must share the dimensionality of the stored vectors.
  queryVector?: ArrayLike<number>;
  abortSignal?: AbortSignal;
}

const DEFAULT_TOP_K = 6;
const DEFAULT_MIN_SCORE = 0.25;

// Embed `query` and return the top-K stored posts by cosine similarity, filtered
// by minScore and sorted best-first. Returns [] when the index is empty or nothing
// clears the threshold.
export async function searchPosts(
  ports: SearchPorts,
  query: string,
  opts: SearchOptions = {},
): Promise<ScoredPost[]> {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;

  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const stored = await ports.store.allVectors(ports.embeddingModelId);
  if (stored.length === 0) {
    return [];
  }

  // Prefer a host-supplied query vector (server-side embed). Otherwise embed
  // on-device with the injected model.
  let queryVec: ArrayLike<number>;
  if (opts.queryVector) {
    queryVec = opts.queryVector;
  } else {
    if (!ports.embeddingModel) {
      throw new Error(
        "searchPosts: provide opts.queryVector or ports.embeddingModel",
      );
    }
    const { embedding } = await embed({
      model: ports.embeddingModel,
      value: `${opts.queryPrefix ?? ""}${trimmed}`,
      abortSignal: opts.abortSignal,
    });
    queryVec = embedding;
  }

  return stored
    .map((row) => ({
      serverId: row.serverId,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      score: cosineSim(queryVec, row.vector),
    }))
    .filter((p) => p.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
