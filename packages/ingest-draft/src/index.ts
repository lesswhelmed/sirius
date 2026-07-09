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
      "Lowercase kebab-case slug derived from the title; the worker will normalize",
    ),
  // NOTE: tags/categories carry NO .min/.max here on purpose. Gemini (esp. flash)
  // does not reliably honor JSON-schema minItems/maxItems, so a strict bound made
  // every over-production ("4 categories instead of 3") fail Zod validation —
  // surfacing as the AI SDK's "No object generated: response did not match schema."
  // and losing the whole post. The count is enforced by clamping in the worker
  // (toGeminiOutput) instead; the guidance below still steers the model.
  tags: z
    .array(z.string())
    .describe("1-5 lowercase kebab-case tags (the worker keeps the first 5)"),
  categories: z
    .array(z.string())
    .describe(
      "1-3 hierarchical category paths, slash-delimited from broad to narrow, lowercase kebab-case (e.g. 'technology/artificial-intelligence', 'design/typography'), ORDERED most-representative first — the worker keeps the first 3 (the post itself keeps only the single best-fitting category; the rest become tags). Reuse common broad top-level fields (technology, design, business, history, science, art, lifestyle, finance) rather than inventing near-duplicates. A single broad term with no subtopic is fine (e.g. 'cooking').",
    ),
  // Optional for the same reason the arrays carry no bounds: flash sometimes
  // omits described-optional fields, and a missing excerpt must not fail the
  // post — post-writer derives a first-sentence fallback instead.
  excerpt: z
    .string()
    .optional()
    .describe(
      "One plain declarative sentence summarizing the post. No hype, no ellipsis.",
    ),
  body: z
    .string()
    .min(1)
    .describe(
      "MDX body content: a maximal-detail RAW ANALYSIS of the material in a neutral analyst voice (third person, never 'I'), structured with ## markdown sections, as long as the material warrants (typically 300-1200 words). No frontmatter, no wrapping code fences. Never embed image markdown or URLs; media is attached and rendered separately by the app.",
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
      "2-5 word noun phrase naming the literal subject of the photo(s). No clickbait, no adjectives-as-hype.",
    ),
  slug: z
    .string()
    .optional()
    .describe("Lowercase kebab-case slug; the worker will normalize"),
  // See PostDraftSchema: no .min/.max on the arrays — bounds are clamped in the
  // worker (toGeminiOutput), not validated, so Gemini's loose adherence to
  // minItems/maxItems can't fail the post.
  tags: z
    .array(z.string())
    .describe("1-5 lowercase kebab-case tags (the worker keeps the first 5)"),
  categories: z
    .array(z.string())
    .describe(
      "1-3 hierarchical category paths, slash-delimited from broad to narrow, lowercase kebab-case (e.g. 'objects/footwear', 'nature/plants'), ORDERED most-representative first — the worker keeps the first 3 (the post itself keeps only the single best-fitting category; the rest become tags). Reuse common broad top-level fields rather than inventing near-duplicates. A single broad term with no subtopic is fine.",
    ),
  body: z
    .string()
    .min(1)
    .describe(
      "150-500 words: an exhaustive visual RAW ANALYSIS in a neutral analyst voice (third person, never 'I'), structured with ## markdown sections. Describe only what is visibly present — subjects, setting, composition, lighting, colors, condition, brands/labels, text in the images. No metaphor, no mood-painting. No image markdown or URLs — the photos render separately.",
    ),
  // Optional: flash sometimes omits it. The worker falls back to the first
  // sentence of the body rather than failing the post on a missing excerpt.
  excerpt: z
    .string()
    .optional()
    .describe("One plain declarative sentence summarizing the photo. No hype."),
  imageAlts: z
    .array(z.string())
    .describe(
      "One short, factual caption per attached image, in the same order the images were given. Plain description for alt text.",
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

// Reflection prompts: the AI-generated questions inviting the post owner to
// write their own take (the human layer on top of the raw analysis). Structured
// output for the worker's reflection stage; shared here so a future on-device
// path can produce the same shape. Same no-array-bounds rule as the draft
// schemas — the worker clamps to 5.
export const ReflectionPromptsSchema = z.object({
  prompts: z
    .array(
      z.object({
        question: z
          .string()
          .min(1)
          .describe(
            "One reflection question addressed to the author ('you'), specific to this material and connected to their existing interests. Thought-provoking, answerable in a paragraph of their own words — never generic filler like 'what do you think?'.",
          ),
        rationale: z
          .string()
          .optional()
          .describe(
            "Optional one-line 'why we're asking you this' — the connection to their material or interests that makes the question worth answering.",
          ),
      }),
    )
    .describe(
      "3-5 reflection questions, ordered most compelling first (the worker keeps the first 5).",
    ),
});

export type ReflectionPrompts = z.infer<typeof ReflectionPromptsSchema>;

export {
  VOICE_PROFILE_MAX_CHARS,
  sanitizeVoiceProfile,
  buildVoiceInstruction,
  VOICE_GENERATOR_PROMPT,
} from "./voice";
