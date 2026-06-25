// Semantic (meaning/similarity) retrieval (swap seam — spec §6). v1: embed the
// query with the asymmetric search prefix, then brute-force cosine over the
// owner's PostEmbedding rows. Owner-scoping is guaranteed because the rows come
// from getEmbeddingSceneRows(ownerId) (owner-filtered). Upgrade path (no
// tool-contract change): pgvector vector(768) + HNSW + SQL `<=>`.
import {
  cosineSimilarity,
  embedContent,
  getEmbeddingSceneRows,
  listPostsBySlugs,
  queryPrefix,
} from "@repo/db";

import { type PostSummary, postSummaryWithRelations } from "./summary";

export interface SemanticHit extends PostSummary {
  score: number;
  snippet: string;
}

// Thrown when the upstream embedding call fails (Gemini down / no key). Tools
// catch this and return a graceful "semantic search temporarily unavailable"
// error result rather than crashing the request (spec §8).
export class EmbeddingUnavailableError extends Error {
  constructor() {
    super("semantic search temporarily unavailable");
    this.name = "EmbeddingUnavailableError";
  }
}

const SNIPPET_MAX = 280;

// NOTE: this owner-scoped embedding-only search backs the MCP `semantic_search`
// tool (it returns a per-hit score the tool surfaces). The web/mobile search UI
// uses @repo/db `searchCorpus`, which fuses THIS embedding leg with full-text via
// RRF — searchCorpus is the superset; this stays for the score-exposing tool.
export async function semanticSearch(
  ownerId: string,
  query: string,
  params: { limit?: number; minScore?: number } = {},
): Promise<SemanticHit[]> {
  const k = Math.min(25, Math.max(1, params.limit ?? 10));
  const minScore = params.minScore;

  let queryVector: number[];
  try {
    queryVector = await embedContent([{ text: queryPrefix(query) }]);
  } catch {
    throw new EmbeddingUnavailableError();
  }

  const rows = await getEmbeddingSceneRows(ownerId);
  const scored = rows.posts
    .map((row) => ({
      row,
      score: cosineSimilarity(queryVector, row.embedding),
    }))
    .filter((s) => (minScore == null ? true : s.score >= minScore))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  // Enrich the top-K with real post metadata (excerpt/type/status/relations) in
  // one owner-scoped batch query — the scene rows only carry slug/title. The
  // slugs already come from the owner's scene, so the fetch is owner-safe.
  const full = await listPostsBySlugs(
    ownerId,
    scored.map((s) => s.row.post.slug),
  );
  const bySlug = new Map(full.map((p) => [p.slug, p]));

  return scored.map(({ row, score }) => {
    const post = bySlug.get(row.post.slug);
    const base: PostSummary = post
      ? postSummaryWithRelations(post)
      : {
          // Fallback only if the post vanished between scene build and fetch.
          slug: row.post.slug,
          title: row.post.title,
          excerpt: null,
          type: "",
          status: "",
          categories: [],
          tags: [],
          createdAt: row.createdAt.toISOString(),
        };
    return { ...base, score, snippet: makeSnippet(row.retrievalText) };
  });
}

function makeSnippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > SNIPPET_MAX
    ? `${clean.slice(0, SNIPPET_MAX)}…`
    : clean;
}
