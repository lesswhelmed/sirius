// Gemini Embedding 2 client + the retrieval contract (prefixes, model, dims),
// the SINGLE source of truth shared by the worker (ingest-time post/project/
// category embeddings) and apps/web (the "ask my posts" query embed). Both sides
// MUST embed through here so a query vector and the stored document vectors live
// in the same space — see apps/web .../research/embed-query and the mobile sync
// that mirrors PostEmbedding vectors into the on-device index.
//
// Uses @google/genai directly — NOT @ai-sdk/google (generation) or the deprecated
// @google/generative-ai. gemini-embedding-2 is multimodal: text + image/audio/
// video/pdf parts map into one vector space; a single embedContent call returns
// ONE aggregated vector for all parts. Task is expressed as a TEXT PREFIX in the
// content (gemini-embedding-2 has no taskType param), so query and document sides
// must use matching prefixes for cosine comparison to be meaningful.

import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";

// gemini-embedding-2 (GA), accessed via @google/genai.
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2";
// MRL output size; gemini-embedding-2 auto-renormalizes truncated dims.
const DEFAULT_EMBEDDING_DIMENSIONALITY = 768;

export { DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_DIMENSIONALITY };

export function resolveApiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY
  );
}

export function requireApiKey(): string {
  const key = resolveApiKey();
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY environment variable required (see .env.example)",
    );
  }
  return key;
}

export function getEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
}

export function getEmbeddingDimensionality(): number {
  const raw = Number(process.env.EMBEDDING_DIMENSIONALITY);
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_EMBEDDING_DIMENSIONALITY;
}

// Stable tag for a vector's space = model + dimensionality. It keys the on-device
// post_vectors rows and is returned by the query-embed endpoint so the mobile
// search compares a query vector only against document vectors from the same
// space. A model/dim change transparently rotates to a parallel, incompatible set.
export function embeddingModelTag(): string {
  return `${getEmbeddingModel()}:${getEmbeddingDimensionality()}`;
}

// A single content part: text, or inline base64-encoded media bytes.
export type EmbedPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

// Model input limits (gemini-embedding-2). Enforced by callers building parts.
export const EMBED_LIMITS = {
  maxInputTokens: 8192,
  maxImages: 6,
  maxAudioSeconds: 180,
  maxVideoSeconds: 120,
  maxPdfPages: 6,
} as const;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: requireApiKey() });
  }
  return client;
}

// Embed one content (text + optional inline media) into a single vector.
export async function embedContent(
  parts: EmbedPart[],
  opts: { dimensionality?: number } = {},
): Promise<number[]> {
  if (parts.length === 0) {
    throw new Error("embedContent: at least one part required");
  }
  const dimensionality = opts.dimensionality ?? getEmbeddingDimensionality();
  const res = await getClient().models.embedContent({
    model: getEmbeddingModel(),
    contents: [{ parts }],
    config: { outputDimensionality: dimensionality },
  });
  const values = res.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error("embedContent: model returned no embedding values");
  }
  return values;
}

// ── Task-prefix helpers ──────────────────────────────────────────────────────
// Asymmetric retrieval: prefix the query side, structure the document side.
export function queryPrefix(text: string): string {
  return `task: search result | query: ${text}`;
}

export function documentText(name: string, text: string): string {
  return `title: ${name} | text: ${text}`;
}

// ── Vector math ──────────────────────────────────────────────────────────────
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: length mismatch (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Stable hash of the exact (prefixed) input, used to skip re-embedding unchanged
// content. Include the model+dim so a config change invalidates cached vectors.
export function embeddingHash(input: string): string {
  return createHash("sha256")
    .update(`${getEmbeddingModel()}:${getEmbeddingDimensionality()}:${input}`)
    .digest("hex");
}
