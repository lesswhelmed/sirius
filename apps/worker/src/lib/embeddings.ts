// The Gemini embed client + retrieval contract now lives in @repo/db
// (packages/db/src/embed-client.ts) so apps/web can embed a query in the SAME
// space as the worker's stored document vectors. This module stays as the worker's
// import surface — a thin re-export — so the pipeline's call sites are unchanged.
export {
  cosineSimilarity,
  documentText,
  EMBED_LIMITS,
  type EmbedPart,
  embedContent,
  embeddingHash,
  embeddingModelTag,
  queryPrefix,
} from "@repo/db";
