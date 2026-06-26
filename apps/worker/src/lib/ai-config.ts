// Shared AI configuration — single source of truth for env vars, model defaults,
// and API key resolution. All AI code imports from here instead of hardcoding
// env lookups or model names.
//
// The EMBEDDING contract (model, dimensionality, api-key resolution) lives in
// @repo/db's embed-client so apps/web can embed queries in the same space as the
// worker's stored vectors; we re-export those resolvers here to keep this file the
// worker's one config surface.
import {
  DEFAULT_EMBEDDING_DIMENSIONALITY,
  DEFAULT_EMBEDDING_MODEL,
  getEmbeddingDimensionality,
  getEmbeddingModel,
  requireApiKey,
  resolveApiKey,
} from "@repo/db";

export {
  DEFAULT_EMBEDDING_DIMENSIONALITY,
  DEFAULT_EMBEDDING_MODEL,
  getEmbeddingDimensionality,
  getEmbeddingModel,
  requireApiKey,
  resolveApiKey,
};

export type AIConfig = {
  apiKey: string;
  model: string;
  temperature: number;
  embeddingModel: string;
};

// Standard (flash) text model — the default for note/image/video/audio drafting
// where speed + cost matter and quality is on par with Pro (see the gen:try A/B).
// Stable id (no `-preview`), so it won't 404 on a deprecation.
const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_TEMPERATURE = 0.7;
// Heavy (pro) text model — used for the high-value paths (url/FINDING + its
// dedicated runners, and document) where the extra reasoning earns its cost.
// `gemini-3-pro` does not exist and `gemini-3-pro-preview` is deprecated; the
// only working Gemini-3 Pro text id is this preview. It CAN be retired by
// Google, so it's env-overridable via AI_MODEL_HEAVY and the harness verifies it.
const DEFAULT_HEAVY_MODEL = "gemini-3.1-pro-preview";
// YouTube ingest needs a model that supports fileData YouTube URIs. Preview
// models (e.g. gemini-3.1-pro-preview) routinely return INVALID_ARGUMENT for
// YouTube fileData, so we pin a known-good default and let env override.
const DEFAULT_YOUTUBE_MODEL = "gemini-2.5-pro";

export function getAIConfig(apiKeyOverride?: string): AIConfig {
  const apiKey = apiKeyOverride ?? requireApiKey();
  return {
    apiKey,
    model: process.env.AI_MODEL ?? DEFAULT_MODEL,
    temperature: Number(process.env.AI_TEMPERATURE ?? DEFAULT_TEMPERATURE),
    embeddingModel: process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
  };
}

// The Pro-tier model for heavy paths. AI_MODEL_HEAVY overrides it.
export function getHeavyModel(): string {
  return process.env.AI_MODEL_HEAVY ?? DEFAULT_HEAVY_MODEL;
}

// Tiered routing: url (incl. github/twitter/youtube/instagram sub-paths) and
// document drafting use the heavy Pro model; everything else uses the standard
// flash model. `kind` is the IngestKind string (typed loosely to avoid a
// lib->pipeline import cycle).
export function modelForKind(kind: string): string {
  if (kind === "url" || kind === "document") {
    return getHeavyModel();
  }
  return process.env.AI_MODEL ?? DEFAULT_MODEL;
}

export function getYouTubeModel(): string {
  return process.env.YOUTUBE_AI_MODEL ?? DEFAULT_YOUTUBE_MODEL;
}

// Auto-generated cover images. When a drafted post resolves to no imageUrl
// (notes → BLOG, plain-URL → FINDING), the worker renders a bespoke editorial
// cover with Gemini's Nano Banana Pro so the catalog grid is never empty. Only
// the Pro image model honors imageConfig (aspectRatio/imageSize), so it's the
// default — see image-generator.ts. Strictly non-fatal: a failure leaves the
// post imageless rather than failing the write.
export type ImageGenConfig = {
  enabled: boolean;
  model: string;
  briefModel: string;
  aspectRatio: string;
  imageSize: string;
};

// gemini-3-pro-image-preview = Nano Banana Pro; only it supports imageConfig.
const DEFAULT_IMAGE_GEN_MODEL = "gemini-3-pro-image-preview";
// Cheap text model that distills each post into a vivid art-direction brief.
const DEFAULT_IMAGE_BRIEF_MODEL = "gemini-2.5-flash";
// 3:2 sits between the catalog card (4:3) and detail hero (16:10); both crop it
// cleanly under object-cover.
const DEFAULT_IMAGE_ASPECT_RATIO = "3:2";
// "2K" on the gemini-3 image models regressed to returning blank/foggy renders
// (valid image part, no error — so it silently passes the success check and a
// blank cover gets written). "1K" renders correctly. Override via IMAGE_GEN_SIZE.
const DEFAULT_IMAGE_SIZE = "1K";

export function getImageGenConfig(): ImageGenConfig {
  return {
    // Default ON; set IMAGE_GEN_ENABLED=false to disable cover generation.
    enabled: process.env.IMAGE_GEN_ENABLED !== "false",
    model: process.env.IMAGE_GEN_MODEL ?? DEFAULT_IMAGE_GEN_MODEL,
    briefModel: process.env.IMAGE_GEN_BRIEF_MODEL ?? DEFAULT_IMAGE_BRIEF_MODEL,
    aspectRatio:
      process.env.IMAGE_GEN_ASPECT_RATIO ?? DEFAULT_IMAGE_ASPECT_RATIO,
    imageSize: process.env.IMAGE_GEN_SIZE ?? DEFAULT_IMAGE_SIZE,
  };
}

export type ClassifyConfig = {
  enabled: boolean;
  projectMatchMin: number;
  categoryMatchMin: number;
  categoryReuseMin: number;
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
// Reuse threshold for the dynamic topic taxonomy (resolve-categories.ts). Unlike
// categoryMatchMin (content queryPrefix vs facet documentText — asymmetric, so
// scores compress to ~0.6), this compares a model-proposed category LABEL against
// existing topic-node label embeddings — both document-side, short text — so
// scores run high. Calibrated with scripts/smoke-categorize.ts against
// gemini-embedding-2 @ 768 dims: true synonyms land high ("artificial
// intelligence" vs "ai" ≈ 0.93) while related-but-distinct siblings land lower
// ("machine learning" vs "ai" ≈ 0.84), so 0.88 sits in the gap — synonyms collapse
// onto one node, distinct sub-topics stay as separate nested children.
const DEFAULT_CATEGORY_REUSE_MIN = 0.88;

function envFloat(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

export function getClassifyConfig(): ClassifyConfig {
  return {
    // Default ON; set CLASSIFY_ENABLED=false to disable auto-org.
    enabled: process.env.CLASSIFY_ENABLED !== "false",
    projectMatchMin: envFloat(
      "CLASSIFY_PROJECT_MATCH_MIN",
      DEFAULT_PROJECT_MATCH_MIN,
    ),
    categoryMatchMin: envFloat(
      "CLASSIFY_CATEGORY_MATCH_MIN",
      DEFAULT_CATEGORY_MATCH_MIN,
    ),
    categoryReuseMin: envFloat(
      "CATEGORY_REUSE_MIN",
      DEFAULT_CATEGORY_REUSE_MIN,
    ),
  };
}

export {
  DEFAULT_HEAVY_MODEL,
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_BRIEF_MODEL,
  DEFAULT_IMAGE_GEN_MODEL,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  DEFAULT_YOUTUBE_MODEL,
};
