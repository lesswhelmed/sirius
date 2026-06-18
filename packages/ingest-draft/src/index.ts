// Shared post-draft schemas for the ingest pipeline. These are the single
// source of truth for what a drafted post looks like, consumed by:
//   - apps/worker  — Gemini structured output (Output.object) and validation
//                    of client-supplied drafts before skipping the Gemini stage
//   - apps/web     — request validation when a submission carries a draft
//   - apps/mobile  — on-device drafting with a local LLM (generateText + Output.object)
// The post TYPE is intentionally absent everywhere here: the worker forces
// PostType from the submission kind so neither a model regression nor a
// buggy/malicious client can drift it.

import { z } from "zod";

export const PostDraftSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Short, plainspoken title; no clickbait, no marketing copy"),
  slug: z
    .string()
    .optional()
    .describe(
      "Lowercase kebab-case slug derived from the title; the worker will normalize"
    ),
  tags: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("1-5 lowercase kebab-case tags"),
  categories: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe(
      "1-3 hierarchical category paths, slash-delimited from broad to narrow, lowercase kebab-case (e.g. 'technology/artificial-intelligence', 'design/typography'), ORDERED most-representative first (the post keeps only the single best-fitting category; the rest become tags). Reuse common broad top-level fields (technology, design, business, history, science, art, lifestyle, finance) rather than inventing near-duplicates. A single broad term with no subtopic is fine (e.g. 'cooking')."
    ),
  body: z
    .string()
    .min(1)
    .describe(
      "MDX body content. First-person, observational, 80-300 words. No frontmatter, no wrapping code fences. Prose only — never embed image markdown or URLs; photos are attached and rendered separately by the app."
    ),
});

export type PostDraft = z.infer<typeof PostDraftSchema>;

// SIGHT posts are photo-first: the images are rendered as a gallery by the app,
// so the body must be clean prose with NO embedded image markdown. We also ask
// the model for a per-image caption (alt) and a one-line excerpt. Kept separate
// from PostDraftSchema so tightening the SIGHT voice can't affect FINDING /
// Instagram / YouTube / note / file drafts.
export const SightDraftSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe(
      "2-5 word noun phrase naming the literal subject of the photo(s). No clickbait, no adjectives-as-hype."
    ),
  slug: z
    .string()
    .optional()
    .describe("Lowercase kebab-case slug; the worker will normalize"),
  tags: z.array(z.string()).min(1).max(5).describe("1-5 lowercase kebab-case tags"),
  categories: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe(
      "1-3 hierarchical category paths, slash-delimited from broad to narrow, lowercase kebab-case (e.g. 'objects/footwear', 'nature/plants'), ORDERED most-representative first (the post keeps only the single best-fitting category; the rest become tags). Reuse common broad top-level fields rather than inventing near-duplicates. A single broad term with no subtopic is fine."
    ),
  body: z
    .string()
    .min(1)
    .describe(
      "60-160 words, first person, plain and concrete. Describe only what is visibly present. No intensifiers (almost, blinding, neon, aggressive), no metaphor or simile, no mood-painting. No image markdown or URLs — the photos render separately."
    ),
  excerpt: z
    .string()
    .min(1)
    .describe("One plain declarative sentence summarizing the photo. No hype."),
  imageAlts: z
    .array(z.string())
    .describe(
      "One short, factual caption per attached image, in the same order the images were given. Plain description for alt text."
    ),
});

export type SightDraft = z.infer<typeof SightDraftSchema>;

// Wire envelope for a draft produced on the client (on-device LLM). The
// envelope travels inside IngestSubmission.payload; the worker re-validates it
// defensively before skipping its own Gemini stage. `engine` and `draftedAt`
// are provenance only — never trusted for behavior.
export const DraftEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  engine: z.string().min(1),
  draftedAt: z.string(),
  post: PostDraftSchema,
});

export type DraftEnvelope = z.infer<typeof DraftEnvelopeSchema>;

export const SightDraftEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  engine: z.string().min(1),
  draftedAt: z.string(),
  post: SightDraftSchema,
});

export type SightDraftEnvelope = z.infer<typeof SightDraftEnvelopeSchema>;
