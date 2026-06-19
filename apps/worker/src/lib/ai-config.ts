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
			"GEMINI_API_KEY environment variable required (see .env.example)",
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
const DEFAULT_IMAGE_SIZE = "2K";

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
	DEFAULT_EMBEDDING_DIMENSIONALITY,
	DEFAULT_EMBEDDING_MODEL,
	DEFAULT_IMAGE_ASPECT_RATIO,
	DEFAULT_IMAGE_BRIEF_MODEL,
	DEFAULT_IMAGE_GEN_MODEL,
	DEFAULT_IMAGE_SIZE,
	DEFAULT_MODEL,
	DEFAULT_TEMPERATURE,
	DEFAULT_YOUTUBE_MODEL,
};
