// Shared AI configuration — single source of truth for env vars, model defaults,
// and API key resolution. All AI code imports from here instead of hardcoding
// env lookups or model names.

export type AIConfig = {
  apiKey: string;
  model: string;
  temperature: number;
  embeddingModel: string;
};

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TEMPERATURE = 0.7;
// gemini-embedding-2 (GA) is multimodal: text + image/audio/video/pdf map into
// one vector space. Accessed via @google/genai (not @ai-sdk/google) in embeddings.ts.
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2";
// MRL output size; gemini-embedding-2 auto-renormalizes truncated dims.
const DEFAULT_EMBEDDING_DIMENSIONALITY = 768;
// YouTube ingest needs a model that supports fileData YouTube URIs. Preview
// models (e.g. gemini-3.1-pro-preview) routinely return INVALID_ARGUMENT for
// YouTube fileData, so we pin a known-good default and let env override.
const DEFAULT_YOUTUBE_MODEL = "gemini-2.5-pro";

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
      "GEMINI_API_KEY environment variable required (see .env.example)"
    );
  }
  return key;
}

export function getAIConfig(apiKeyOverride?: string): AIConfig {
  const apiKey = apiKeyOverride ?? requireApiKey();
  return {
    apiKey,
    model: process.env.AI_MODEL ?? DEFAULT_MODEL,
    temperature: Number(process.env.AI_TEMPERATURE ?? DEFAULT_TEMPERATURE),
    embeddingModel: process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
  };
}

export function getYouTubeModel(): string {
  return process.env.YOUTUBE_AI_MODEL ?? DEFAULT_YOUTUBE_MODEL;
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

export type ClassifyConfig = {
  enabled: boolean;
  projectMatchMin: number;
  categoryMatchMin: number;
};

// Calibrated against gemini-embedding-2 @ 768 dims (see smoke-classify):
// - Project matching is symmetric (content queryPrefix vs project queryPrefix);
//   genuinely-similar content pairs score ~0.80, so 0.78 reuses a project
//   without over-merging.
// - Category matching is asymmetric (content queryPrefix vs category
//   documentText), which compresses scores: relevant facets land ~0.60-0.62,
//   irrelevant ~0.51, so 0.58 separates them. Categories only inform naming, so
//   leniency here is low-risk.
const DEFAULT_PROJECT_MATCH_MIN = 0.78;
const DEFAULT_CATEGORY_MATCH_MIN = 0.58;

function envFloat(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

export function getClassifyConfig(): ClassifyConfig {
  return {
    // Default ON; set CLASSIFY_ENABLED=false to disable auto-org.
    enabled: process.env.CLASSIFY_ENABLED !== "false",
    projectMatchMin: envFloat("CLASSIFY_PROJECT_MATCH_MIN", DEFAULT_PROJECT_MATCH_MIN),
    categoryMatchMin: envFloat("CLASSIFY_CATEGORY_MATCH_MIN", DEFAULT_CATEGORY_MATCH_MIN),
  };
}

export {
  DEFAULT_EMBEDDING_DIMENSIONALITY,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  DEFAULT_YOUTUBE_MODEL,
};
