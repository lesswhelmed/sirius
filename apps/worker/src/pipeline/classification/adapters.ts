// Per-material adapters: turn a finished Gemini draft + its PipelineInput into a
// uniform { prep, parts } pair. `parts` is what gets embedded by gemini-embedding-2
// (text + optional inline media for one aggregated vector). Runs while staged
// files still exist (inside processIngest, before the worker deletes them).
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { EmbedPart } from "../../lib/embeddings";
import { queryPrefix } from "../../lib/embeddings";
import type { GeminiOutput, PipelineInput } from "../types";
import { buildRetrievalText, type ClassificationPrep } from "./prep";

export interface ClassificationInput {
  prep: ClassificationPrep;
  parts: EmbedPart[];
}

const MAX_EMBED_IMAGES = 6; // gemini-embedding-2 hard cap
const DEFAULT_IMAGE_MIME = "image/jpeg";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

// Pull the IG path's precomputed retrievalText out of contentDigest when present
// (the Instagram digest is the richest signal we have for that kind).
function instagramRetrievalText(frontmatter: Record<string, unknown>): string | null {
  const digest = frontmatter.contentDigest;
  if (digest && typeof digest === "object") {
    const prep = (digest as { classificationPrep?: { retrievalText?: unknown } })
      .classificationPrep;
    if (prep && typeof prep.retrievalText === "string" && prep.retrievalText.length > 0) {
      return prep.retrievalText;
    }
  }
  return null;
}

function buildPrep(
  parsed: GeminiOutput,
  retrievalText: string
): ClassificationPrep {
  const keywords = stringArray(parsed.frontmatter.tags);
  const candidateCategories = stringArray(parsed.frontmatter.categories);
  return {
    retrievalText,
    keywords,
    candidateCategories,
    domainHint: candidateCategories[0] ?? null,
  };
}

// Read up to MAX_EMBED_IMAGES staged images as inline base64 parts. Best-effort:
// a missing/unreadable file is skipped rather than failing the whole embed.
function readImageParts(
  images: { stagedFilePath: string; extension: string }[]
): EmbedPart[] {
  const parts: EmbedPart[] = [];
  for (const img of images.slice(0, MAX_EMBED_IMAGES)) {
    if (!existsSync(img.stagedFilePath)) {
      continue;
    }
    const ext = (img.extension || extname(img.stagedFilePath).slice(1)).toLowerCase();
    const mimeType = IMAGE_MIME_BY_EXT[ext] ?? DEFAULT_IMAGE_MIME;
    try {
      const data = readFileSync(img.stagedFilePath).toString("base64");
      parts.push({ inlineData: { mimeType, data } });
    } catch {
      // skip unreadable image
    }
  }
  return parts;
}

// Build the classification input for any pipeline kind. Multimodal embedding is
// used for SIGHT image batches (the main visual case); url/note/IG/YT and the
// reference-only av/document kinds embed text only — their meaning is already
// summarized into the Gemini-written body, and av duration limits aren't
// measurable here.
export function buildClassificationInput(
  input: PipelineInput,
  parsed: GeminiOutput
): ClassificationInput {
  const tags = stringArray(parsed.frontmatter.tags);
  const categories = stringArray(parsed.frontmatter.categories);
  const excerpt =
    typeof parsed.frontmatter.excerpt === "string"
      ? parsed.frontmatter.excerpt
      : "";

  // Prefer the IG digest's retrievalText when this draft carries one.
  const igText = instagramRetrievalText(parsed.frontmatter);
  const retrievalText =
    igText ??
    buildRetrievalText(parsed.title, parsed.body, [...tags, ...categories, excerpt]);

  const prep = buildPrep(parsed, retrievalText);
  const textPart: EmbedPart = { text: queryPrefix(retrievalText) };

  if (input.kind === "image") {
    const imageParts = readImageParts(input.images);
    // Media first, trailing text — mirrors the docs' interleaved-input ordering.
    return { prep, parts: [...imageParts, textPart] };
  }

  return { prep, parts: [textPart] };
}
