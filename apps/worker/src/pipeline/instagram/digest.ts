// Canonical structured-digestion schema for Instagram posts.
//
// Design intent: the durable artifact is structured JSON, not prose. Every
// field is intended to be re-readable by future similarity / classification
// passes (e.g. "find more vintage M81 woodland camo pants like this one").
//
// Rules of thumb:
// - Be specific about what's actually visible / written; do not invent.
// - Use confidence + evidence for any inferred claim.
// - Keep the schema flat and explicit so embeddings and feature extractors
//   can target stable paths.

import { z } from "zod";
import type { InstagramEvidence } from "./types";

const ConfidenceSchema = z
  .enum(["low", "medium", "high"])
  .describe("Confidence level for an inferred claim.");

const ClaimSchema = z
  .object({
    value: z
      .string()
      .min(1)
      .describe("Short, concrete claim (lowercase noun phrase preferred)."),
    confidence: ConfidenceSchema,
    evidence: z
      .string()
      .describe(
        "What in the image, caption, or metadata supports this claim. Cite verbatim text snippets when possible."
      ),
  })
  .describe("A single inferred claim with confidence and grounding evidence.");

const VisualSchema = z
  .object({
    summary: z
      .string()
      .describe(
        "Two to four concrete sentences describing what is visible in the image/video. Avoid mood adjectives; favor objects, materials, colors, layout."
      ),
    primarySubject: z
      .string()
      .describe("Main subject of the media in 1-6 words, lowercase."),
    objects: z
      .array(z.string())
      .max(40)
      .describe(
        "Distinct objects/items visible (lowercase, singular). For garments include the garment type, e.g. 'cargo pants'."
      ),
    people: z
      .object({
        count: z
          .number()
          .int()
          .nonnegative()
          .describe("Number of people visible. 0 if none."),
        notes: z
          .string()
          .describe(
            "Brief, factual notes about people (pose, framing, what they are doing/wearing). No identity inference."
          ),
      })
      .describe("People presence — counts and factual notes only."),
    setting: z
      .string()
      .describe("Where the photo appears to be taken (indoor/outdoor, type of space)."),
    colors: z
      .array(z.string())
      .max(12)
      .describe("Dominant color names, lowercase, ordered by prominence."),
    palette: z
      .array(
        z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .describe("Hex color, e.g. #4a5d3a")
      )
      .max(6)
      .describe(
        "Up to 6 representative hex colors approximating the image palette."
      ),
    materials: z
      .array(z.string())
      .max(20)
      .describe(
        "Materials/textures visible (e.g. 'ripstop cotton', 'brass hardware', 'leather')."
      ),
    patterns: z
      .array(z.string())
      .max(20)
      .describe(
        "Distinct patterns/prints (e.g. 'm81 woodland camo', 'tigerstripe', 'pinstripe', 'plain')."
      ),
    text: z
      .array(z.string())
      .max(20)
      .describe(
        "Any text/labels visible in the image, verbatim. Empty array if none."
      ),
    logos: z
      .array(z.string())
      .max(20)
      .describe("Brand logos or insignia visible, verbatim or descriptive."),
    composition: z
      .string()
      .describe(
        "Shot framing, angle, lighting style — short factual notes."
      ),
  })
  .describe(
    "Concrete, evidence-based description of the visual content. Treat this as ground truth labelling for future image classifiers."
  );

const GarmentSchema = z
  .object({
    type: z
      .string()
      .describe(
        "Garment type (e.g. 'cargo pants', 'bdu jacket', 'tee shirt'). Lowercase, singular."
      ),
    silhouette: z
      .string()
      .describe(
        "Cut/silhouette description (e.g. 'straight leg', 'cropped', 'oversized boxy')."
      ),
    constructionDetails: z
      .array(z.string())
      .max(20)
      .describe(
        "Specific construction cues: pockets, flaps, drawcords, gussets, stitching, hardware. Be granular."
      ),
    fabricNotes: z
      .string()
      .describe("Best guess of fabric/weave with evidence (e.g. 'ripstop weave visible at hem')."),
    fasteners: z
      .array(z.string())
      .max(10)
      .describe("Buttons, zippers, drawstrings, snaps — itemized."),
    labelsVisible: z
      .array(z.string())
      .max(10)
      .describe("Any visible care/brand labels, verbatim."),
    condition: z
      .string()
      .describe(
        "Apparent condition: nos/deadstock, worn, faded, repaired, distressed, etc."
      ),
  })
  .describe(
    "Per-garment structured record. Include one entry per distinct garment visible. Empty array if no garments."
  );

const DomainSignalsSchema = z
  .object({
    domain: z
      .string()
      .describe(
        "Best-fit domain tag in 1-3 words, lowercase (e.g. 'vintage military apparel', 'food', 'interior design')."
      ),
    eraHypothesis: ClaimSchema.describe(
      "Best-guess era/decade with confidence + evidence (e.g. '1980s', '1990s')."
    ).nullable(),
    regionHypothesis: ClaimSchema.describe(
      "Best-guess region/country of origin with confidence + evidence."
    ).nullable(),
    brandHypothesis: ClaimSchema.describe(
      "Best-guess brand/maker with confidence + evidence."
    ).nullable(),
    patternFamilyHypothesis: ClaimSchema.describe(
      "For camo/print items, the pattern family (e.g. 'm81 woodland', 'erdl', 'tigerstripe', 'flecktarn') with evidence."
    ).nullable(),
    additionalClaims: z
      .array(ClaimSchema)
      .max(20)
      .describe(
        "Any other domain-specific inferences worth preserving with confidence + evidence."
      ),
  })
  .describe(
    "Structured hypotheses about the post's domain, era, region, brand, and pattern. Every inferred claim must carry confidence + evidence."
  );

const ClassificationPrepSchema = z
  .object({
    candidateCategories: z
      .array(z.string())
      .min(1)
      .max(8)
      .describe(
        "Lowercase kebab-case category candidates this post could belong to. Order from most to least specific."
      ),
    distinguishingFeatures: z
      .array(z.string())
      .min(1)
      .max(20)
      .describe(
        "Features a future classifier should weigh heavily to recognize this post's class (e.g. 'm81 woodland four-color leaf pattern', 'cargo pocket below knee', 'brass zipper at fly')."
      ),
    negativeEvidence: z
      .array(z.string())
      .max(20)
      .describe(
        "Features explicitly NOT present that could rule out look-alikes (e.g. 'not desert tan', 'no velcro closures')."
      ),
    keywords: z
      .array(z.string())
      .min(1)
      .max(30)
      .describe(
        "Lowercase normalized keywords useful for retrieval. Combine visible-object and inferred-domain terms."
      ),
    uncertaintyNotes: z
      .string()
      .describe(
        "Brief notes on what could not be determined and why."
      ),
    retrievalText: z
      .string()
      .min(40)
      .describe(
        "A single dense paragraph (about 60-180 words) packed with the concrete nouns, materials, patterns, colors, and domain terms that best describe this post. Intended to be embedded for similarity search. No hedging, no marketing copy."
      ),
  })
  .describe(
    "Pre-computed fields oriented at future embedding/classification work."
  );

export const InstagramContentDigestSchema = z
  .object({
    schemaVersion: z
      .literal("1")
      .describe("Digest schema version. Bump on breaking shape changes."),
    visual: VisualSchema,
    garments: z
      .array(GarmentSchema)
      .max(10)
      .describe("Per-garment structured records. Empty if not apparel."),
    captionAnalysis: z
      .object({
        cleanedCaption: z
          .string()
          .describe(
            "Caption with promo emojis, link spam, and excess whitespace stripped; preserves intent."
          ),
        language: z
          .string()
          .describe(
            "Best-guess BCP-47 language code (e.g. 'en', 'ja'). 'und' if unclear."
          ),
        topics: z
          .array(z.string())
          .max(20)
          .describe("Lowercase topic phrases the caption is about."),
        mentionedEntities: z
          .array(z.string())
          .max(30)
          .describe("Named entities, brands, places, or products mentioned."),
        sentiment: z
          .enum(["positive", "neutral", "negative", "mixed", "unknown"])
          .describe("Overall caption sentiment."),
      })
      .describe("Structured caption analysis."),
    domainSignals: DomainSignalsSchema,
    classificationPrep: ClassificationPrepSchema,
    notes: z
      .string()
      .describe(
        "Free-form notes for future reviewers; brief. Use for anything that doesn't fit elsewhere."
      ),
  })
  .describe(
    "Canonical structured digest of one Instagram post, optimized for future similarity and classification work."
  );

export type InstagramContentDigest = z.infer<
  typeof InstagramContentDigestSchema
>;

export function buildDigestPrompt(
  evidence: InstagramEvidence,
  authorNotes: string
): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    "You are extracting a structured digest from a single Instagram post.",
    "Your output is consumed by downstream similarity search and classifiers — accuracy and concreteness matter more than tone.",
    `Today's date: ${today}.`,
    "",
    "Rules:",
    "- Only state what is visible in the image/video or written in the caption/metadata.",
    "- Any inference must include confidence (low/medium/high) AND evidence.",
    "- Prefer specific nouns over adjectives ('cargo pants' not 'cool pants'; 'ripstop cotton' not 'durable fabric').",
    "- Use lowercase, kebab-case for categories; lowercase for keywords.",
    "- For camo/print items, name the pattern family if recognizable (e.g. m81 woodland, erdl, tigerstripe, flecktarn, desert dcu).",
    "- If a field is not determinable, return a sensible empty value (empty array, empty string, or null where allowed) rather than guessing.",
    "",
    "## Source metadata",
    `URL: ${evidence.url}`,
    `Shortcode: ${evidence.shortcode ?? "(unknown)"}`,
    `Type: ${evidence.postType}`,
    evidence.createdAt ? `Created at: ${evidence.createdAt}` : "Created at: (unknown)",
    `Owner: @${evidence.owner.username ?? "unknown"}${
      evidence.owner.fullName ? ` (${evidence.owner.fullName})` : ""
    }${evidence.owner.isVerified ? " [verified]" : ""}`,
    evidence.owner.followerCount !== null
      ? `Owner followers: ${evidence.owner.followerCount}`
      : "",
    evidence.location?.name ? `Location: ${evidence.location.name}` : "",
    "",
    "## Engagement",
    `likes=${evidence.likeCount ?? "n/a"} comments=${evidence.commentCount ?? "n/a"} plays=${evidence.playCount ?? "n/a"} views=${evidence.viewCount ?? "n/a"}`,
    "",
    "## Hashtags",
    evidence.hashtags.length > 0 ? evidence.hashtags.map((h) => `#${h}`).join(" ") : "(none)",
    "",
    "## Mentions",
    evidence.mentions.length > 0 ? evidence.mentions.map((m) => `@${m}`).join(" ") : "(none)",
    "",
    "## Caption (verbatim)",
    evidence.caption ?? "(empty)",
  ].filter(Boolean);

  if (authorNotes.trim()) {
    lines.push("", "## Author's notes (verbatim)", authorNotes.trim());
  }

  lines.push(
    "",
    "Return a single InstagramContentDigest object that strictly matches the provided schema."
  );

  return lines.join("\n");
}

export function buildRetrievalTextFallback(
  evidence: InstagramEvidence,
  digest: InstagramContentDigest
): string {
  const parts = [
    digest.visual.summary,
    digest.visual.objects.join(", "),
    digest.visual.patterns.join(", "),
    digest.visual.materials.join(", "),
    digest.visual.colors.join(", "),
    digest.classificationPrep.keywords.join(", "),
    evidence.caption ?? "",
  ].filter((p) => p && p.trim().length > 0);
  return parts.join(" \u2014 ");
}
