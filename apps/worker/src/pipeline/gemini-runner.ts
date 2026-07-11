// Calls Gemini via Vercel AI SDK (`ai` + `@ai-sdk/google`). Uses generateText
// with Output.object(zodSchema) so the returned `output` is guaranteed to
// match the Zod schema — no manual JSON parsing, no hand-rolled JSON Schema.
// URL ingests run a two-step pattern: first call uses google.tools.urlContext
// to fetch + summarize, second call structures that summary into
// PostDraftSchema. Gemini rejects tools + responseMimeType=application/json in
// the same request, so we split them. For images we attach inline image parts.
// The worker forces the post type after the model returns so a model
// regression can't drift it.

import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { PostType } from "@repo/db";
import { extractUrlContext } from "@repo/extraction";
import { parseGitHubUrl } from "@repo/github-ingest";
import type { PostDraft } from "@repo/ingest-draft";
import { PostDraftSchema, SightDraftSchema } from "@repo/ingest-draft";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { getAIConfig, modelForKind } from "../lib/ai-config";
import { SafetyFlagError, type SafetyVerdict } from "./safety";
import { analysisContractLines } from "./analysis-contract";
import { repairCollapsedMarkdown } from "./markdown-repair";
import { notesLeadLines } from "./prompt-blocks";
import { parseInstagramUrl } from "../lib/instagram-url";
import { parseTwitterUrl } from "../lib/twitter-url";
import { parseYouTubeUrl } from "../lib/youtube-url";
import { runDocumentGemini } from "./document/runner";
import { runGitHubGemini } from "./github/runner";
import { runInstagramGemini } from "./instagram/runner";
import { extractImageOcr } from "./ocr/extract";
import { runTwitterGemini } from "./twitter/runner";
import type { GeminiOutput, PipelineInput, StagedImage } from "./types";
import { runYouTubeGemini } from "./youtube/runner";

export type { SightDraft } from "@repo/ingest-draft";
export type { PostDraft };
// Draft schemas live in @repo/ingest-draft (shared with web validation and the
// mobile on-device drafting path). Re-exported so existing imports keep working.
export { PostDraftSchema, SightDraftSchema };

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
};

function mimeForImage(staged: StagedImage): string {
  const ext = (
    staged.extension || extname(staged.stagedFilePath).slice(1)
  ).toLowerCase();
  return MIME_BY_EXT[ext] ?? "image/jpeg";
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `untitled-${Date.now()}`
  );
}

// Exported for unit testing — the prompt is the pure, durable transformation;
// the generateText call around it isn't unit-testable without a live model.
// Bodies are RAW ANALYSES (see analysis-contract.ts): neutral analyst voice,
// maximal type-appropriate extraction. The author's voiceProfile deliberately
// does NOT touch these prompts anymore — it personalizes the reflection
// questions (pipeline/reflection) instead.
export function buildPrompt(input: PipelineInput): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`Today's date: ${today}.`, ""];

  // url-kind extraction prompts live in @repo/extraction (shared with the web
  // extract endpoint); runGemini's url branch never reaches this builder.
  if (input.kind === "image") {
    lines.push(...notesLeadLines(input.notes));
    lines.push(
      `${input.images.length} photo(s) are attached, in order.`,
      ...analysisContractLines({
        kindLabel:
          input.images.length > 1 ? "a set of photos" : "a photo",
        lengthHint: "150-500 words",
        breakdownHint:
          "photo-by-photo: subjects, setting, composition, lighting, colors, condition, brands/labels/signage, and any text visible in the images. Describe only what is visibly present.",
      }),
      "Title: a 2-5 word noun phrase naming the literal subject.",
      "Also return one short factual caption per photo in imageAlts, in the same order.",
    );
  } else if (input.kind === "note") {
    // The note IS the human layer — preserve it verbatim (product decision
    // 2026-07-09: never paraphrase away the author's own words), then analyze
    // around it.
    lines.push(
      "The author's note below is the core of this post. PRESERVE it verbatim — do not paraphrase, correct, trim, or rewrite it.",
      "Return the body as: the author's note exactly as written (no heading, no edits), then a `---` divider, then your analysis of it.",
      "For the analysis part:",
      ...analysisContractLines({
        kindLabel: "the author's own note",
        lengthHint: "as long as the note warrants — a one-line note needs only a brief analysis",
        breakdownHint:
          "the themes and threads in the note, connections between its ideas, and what the author seems to be working toward.",
      }),
      "",
      "AUTHOR'S NOTE (verbatim, becomes the top of the body):",
      input.notes.trim(),
    );
  } else {
    // video | audio | document — reference-only: analyze the attached file's
    // content as text. No media is embedded in the post.
    const kindLabels: Record<string, string> = {
      video: "a video",
      audio: "an audio recording",
      document: "a document",
    };
    const breakdowns: Record<string, string> = {
      video:
        "a scene-by-scene timeline: what is shown and said, on-screen text, people, setting, and notable moments (with rough timestamps).",
      audio:
        "the recording's content in order: key points, distinguishable speakers and their turns, and the topics discussed.",
      document:
        "section-by-section: the document's structure, key claims and evidence, methodology, and tables/figures.",
    };
    lines.push(...notesLeadLines(input.notes));
    lines.push(
      `A ${input.kind.toUpperCase()} file is attached.`,
      ...analysisContractLines({
        kindLabel: kindLabels[input.kind] ?? "an attached file",
        lengthHint: "300-1200 words, as long as the material warrants",
        breakdownHint: breakdowns[input.kind] ?? "a type-appropriate deep extraction.",
        extraSections: [
          "## Extracted text — verbatim transcript or text passages that carry the substance of the material.",
        ],
      }),
    );
  }
  return lines.join("\n");
}

export function buildUrlStructuringPrompt(
  summary: string,
  notes: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `Today's date: ${today}.`,
    "",
    ...notesLeadLines(notes),
    ...analysisContractLines({
      kindLabel: "a web page (from the pre-fetched summary below)",
      lengthHint: "300-1200 words, as long as the material warrants",
      breakdownHint:
        "the page's full content and argument structure: its sections, claims and evidence, and notable passages.",
    }),
    "Ground every statement in the pre-fetched summary — do not go beyond it.",
    "",
    "Pre-fetched URL summary:",
    summary,
  ];
  return lines.join("\n");
}

// Defense-in-depth for the DRAFT call (the primary protection is the safety gate
// in pipeline.ts, which scans BEFORE drafting). The gate already catches medium+
// harm with a nuanced classifier, so here we only need a blunt backstop for
// egregious content that slipped through — BLOCK_ONLY_HIGH minimizes false
// refusals on legitimate edgy content the gate already cleared. (child-safety
// stays non-configurably blocked regardless.)
const DRAFT_SAFETY_SETTINGS = [
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" }));

// Exported for the reflection stage (pipeline/reflection), which makes its own
// ancillary flash call with the same provider guardrails.
export const DRAFT_PROVIDER_OPTIONS = {
  google: { safetySettings: DRAFT_SAFETY_SETTINGS },
} as const;

// If the draft model refused on safety grounds, the content is harmful enough
// that even Gemini's blunt filter blocked it — escalate to a flag (quarantine +
// alert) rather than a silent retryable failure. This only fires for items the
// primary gate missed (a rare false negative).
function assertDraftNotBlocked(finishReason: string | undefined): void {
  if (finishReason === "content-filter") {
    const verdict: SafetyVerdict = {
      safe: false,
      severity: "high",
      categories: [],
      rationale:
        "draft model refused on safety grounds (finishReason=content-filter)",
    };
    throw new SafetyFlagError(verdict, "flag");
  }
}

function loadImagePart(staged: StagedImage) {
  return {
    type: "image" as const,
    image: readFileSync(staged.stagedFilePath),
    mediaType: mimeForImage(staged),
  };
}

export function toGeminiOutput(
  draft: PostDraft,
  forcedType: PostType,
  opts?: {
    originalUrl?: string;
    excerpt?: string;
    imageAlts?: string[];
    // Skip the collapsed-markdown repair: set by manual-stub, whose body is
    // the USER'S verbatim material and must never be re-templated.
    verbatimBody?: boolean;
  },
): GeminiOutput {
  const title = draft.title.trim() || "Untitled Ingest";
  const slug = slugify(draft.slug?.trim() || title);
  const trimmedUrl = opts?.originalUrl?.trim() || "";
  // Enforce the tag/category counts HERE rather than in the Zod schema: the
  // draft schema deliberately drops .min/.max (Gemini ignores minItems/maxItems,
  // so a strict bound failed the whole post on over-production). Clamp to the
  // documented limits; the model orders most-representative first, so slicing
  // keeps the best ones.
  const tags = (draft.tags ?? []).slice(0, 5);
  const categories = (draft.categories ?? []).slice(0, 3);
  const frontmatter: Record<string, unknown> = {
    title,
    type: forcedType,
    status: "DRAFT",
    published: false,
    date: new Date().toISOString().slice(0, 10),
    tags,
    categories,
    slug,
  };
  if (trimmedUrl) {
    frontmatter.original_url = trimmedUrl;
  }
  // Excerpt: explicit opts win (client-draft SIGHT caller), else the draft's
  // own optional excerpt (on PostDraftSchema for every kind since 2026-07).
  // Clamped to 200 chars like the tag/category counts — steer in the prompt,
  // enforce here. Posts with no excerpt at all get a first-sentence fallback
  // in post-writer, so this stays absence-tolerant.
  const excerpt = (opts?.excerpt ?? draft.excerpt)?.trim().slice(0, 200);
  if (excerpt) {
    frontmatter.excerpt = excerpt;
  }
  // Per-image alt text for the SIGHT gallery; post-writer pairs these with the
  // copied image URLs in order.
  if (opts?.imageAlts && opts.imageAlts.length > 0) {
    frontmatter.image_alts = opts.imageAlts;
  }
  // Guardrail: Gemini's JSON mode sometimes strips every newline from the
  // body (one giant line → renders as one giant h2). Deterministically
  // re-insert the structural breaks around the known contract headings;
  // words are never altered. See markdown-repair.ts.
  const drafted = opts?.verbatimBody
    ? draft.body.trim()
    : repairCollapsedMarkdown(draft.body.trim());
  let sourceLine = "";
  if (trimmedUrl) {
    sourceLine = parseYouTubeUrl(trimmedUrl)
      ? `<YouTubeEmbed url="${trimmedUrl}" />\n\n`
      : `Source: ${trimmedUrl}\n\n`;
  }
  const body = `${sourceLine}${drafted}\n`;
  return {
    slug,
    title,
    type: forcedType,
    body,
    frontmatter,
    rawMdx: body,
  };
}

// Minimal logger seam (structurally compatible with pipeline.ts's StageLogger)
// so runGemini can emit injection proof without importing the pipeline module.
export type StageLog = (stage: string, extra?: Record<string, unknown>) => void;

// Number of attempts for a structured-output (Output.object) call before the
// failure propagates. The first attempt plus (N-1) retries. Gemini's structured
// output is occasionally non-deterministically malformed (unparseable JSON, an
// empty completion when the thinking budget is exhausted); a fresh sample at the
// same temperature usually succeeds. Schema-shape mismatches are already handled
// by the lenient draft schema + clamp, so this only catches the genuinely
// transient cases. Override with GEMINI_OBJECT_MAX_ATTEMPTS.
const OBJECT_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.GEMINI_OBJECT_MAX_ATTEMPTS ?? 3),
);

// Pull the diagnostic fields off an AI SDK NoObjectGeneratedError so the worker
// logs WHY structured output failed (which the bare error.message hides): the
// finish reason, token usage, the offending validation/parse cause, and a short
// slice of the raw text. Returns null for any other error so callers can spread
// it unconditionally. Exported so pipeline.ts can enrich its dead-letter log.
export function noObjectErrorDetail(
  error: unknown,
): Record<string, unknown> | null {
  if (!NoObjectGeneratedError.isInstance(error)) {
    return null;
  }
  const { cause, finishReason, usage, text } = error;
  return {
    noObject: true,
    finishReason,
    usage,
    cause: cause instanceof Error ? cause.message : cause ? String(cause) : null,
    textSnippet: typeof text === "string" ? text.slice(0, 400) : null,
  };
}

// Retry wrapper for Output.object calls. Only retries NoObjectGeneratedError
// (the recoverable "model returned bad/empty structured output" case) — any
// other error (network, auth, content-filter) rethrows immediately so we don't
// mask real failures or burn quota on a permanent error.
export async function withObjectRetry<T>(
  label: string,
  logger: StageLog | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= OBJECT_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const detail = noObjectErrorDetail(error);
      if (detail && attempt < OBJECT_MAX_ATTEMPTS) {
        logger?.("gemini:object-retry", { label, attempt, ...detail });
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function runGemini(
  input: PipelineInput,
  opts?: { logger?: StageLog },
): Promise<GeminiOutput> {
  const config = getAIConfig();
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
  // Tiered model: url/document → heavy (Pro), else standard (flash).
  const modelId = modelForKind(input.kind);
  const model = google(modelId);

  // The author's voiceProfile no longer shapes ANY body prompt (raw-analysis
  // pivot 2026-07): it personalizes the reflection questions instead
  // (pipeline/reflection). Bodies are neutral analyst voice by contract.
  const trimmedNotes = input.notes.trim();
  opts?.logger?.("prompt:built", {
    kind: input.kind,
    model: modelId,
    temperature: config.temperature,
    notesApplied: trimmedNotes.length > 0,
    notesChars: trimmedNotes.length,
  });

  if (input.kind === "url") {
    const githubUrls = input.urls.filter((u) => parseGitHubUrl(u));
    const nonGithubUrls = input.urls.filter((u) => !parseGitHubUrl(u));
    // Single-URL GitHub repo ingest: take the dedicated structure+key-files
    // path. Mixed batches fall through so we don't lose the other URLs.
    if (githubUrls.length === 1 && nonGithubUrls.length === 0) {
      try {
        const result = await runGitHubGemini({
          url: githubUrls[0]!,
          notes: input.notes,
        });
        if (result) {
          return result.output;
        }
      } catch (error) {
        console.warn(
          `[github] dedicated path failed, falling back to url_context: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const instagramUrls = input.urls.filter((u) => parseInstagramUrl(u));
    const nonInstagramUrls = input.urls.filter((u) => !parseInstagramUrl(u));
    // Single-URL Instagram ingest: take the dedicated path. Mixed batches
    // fall through to YouTube/url_context so we don't lose the others.
    if (instagramUrls.length === 1 && nonInstagramUrls.length === 0) {
      try {
        const result = await runInstagramGemini({
          url: instagramUrls[0]!,
          notes: input.notes,
        });
        if (result) {
          return result.output;
        }
      } catch (error) {
        console.warn(
          `[instagram] dedicated path failed, falling back to url_context: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const twitterUrls = input.urls.filter((u) => parseTwitterUrl(u));
    const nonTwitterUrls = input.urls.filter((u) => !parseTwitterUrl(u));
    // Single-URL X / Twitter ingest: take the dedicated Apify path. Mixed
    // batches fall through to url_context so we don't lose the others.
    if (twitterUrls.length === 1 && nonTwitterUrls.length === 0) {
      try {
        const result = await runTwitterGemini({
          url: twitterUrls[0]!,
          notes: input.notes,
        });
        if (result) {
          return result.output;
        }
      } catch (error) {
        console.warn(
          `[twitter] dedicated path failed, falling back to url_context: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const youtubeUrls = input.urls.filter((u) => parseYouTubeUrl(u));
    const nonYoutubeUrls = input.urls.filter((u) => !parseYouTubeUrl(u));
    // Single-URL YouTube ingest: take the dedicated path. Mixed batches stay
    // on url_context so we don't lose the non-YouTube URLs.
    if (youtubeUrls.length === 1 && nonYoutubeUrls.length === 0) {
      try {
        const result = await runYouTubeGemini({
          url: youtubeUrls[0]!,
          notes: input.notes,
        });
        if (result) {
          return result.output;
        }
      } catch (error) {
        console.warn(
          `[youtube] dedicated path failed, falling back to url_context: ${error instanceof Error ? error.message : String(error)}`,
        );
        const e = error as {
          cause?: unknown;
          responseBody?: unknown;
          data?: unknown;
          statusCode?: unknown;
          url?: unknown;
        };
        if (e.statusCode !== undefined) {
          console.warn(`[youtube] http status: ${String(e.statusCode)}`);
        }
        if (e.url !== undefined) {
          console.warn(`[youtube] request url: ${String(e.url)}`);
        }
        if (e.responseBody !== undefined) {
          console.warn(
            `[youtube] response body: ${typeof e.responseBody === "string" ? e.responseBody : JSON.stringify(e.responseBody)}`,
          );
        }
        if (e.data !== undefined) {
          console.warn(
            `[youtube] response data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}`,
          );
        }
        if (e.cause !== undefined) {
          const cause = e.cause as { message?: unknown };
          console.warn(
            `[youtube] cause: ${cause?.message !== undefined ? String(cause.message) : JSON.stringify(e.cause)}`,
          );
        }
      }
    }
    // Step 1 (extraction) is shared with the web /api/app/extract endpoint;
    // the worker passes notes (historical behavior), the endpoint does not.
    const { summary } = await extractUrlContext({
      urls: input.urls,
      notes: input.notes,
      apiKey: config.apiKey,
      model: modelId,
      temperature: config.temperature,
    });
    const { output, finishReason } = await withObjectRetry(
      "url",
      opts?.logger,
      () =>
        generateText({
          model,
          temperature: config.temperature,
          prompt: buildUrlStructuringPrompt(summary, input.notes),
          providerOptions: DRAFT_PROVIDER_OPTIONS,
          output: Output.object({ schema: PostDraftSchema }),
        }),
    );
    assertDraftNotBlocked(finishReason);
    return toGeminiOutput(output, "FINDING", { originalUrl: input.urls[0] });
  }

  const prompt = buildPrompt(input);

  if (input.kind === "image") {
    const imageParts = input.images.map(loadImagePart);
    // OCR pre-pass runs concurrently with the SIGHT draft (independent calls).
    // Master switch OCR_ENABLED (default ON); set to "false" to disable.
    const ocrEnabled = process.env.OCR_ENABLED !== "false";
    const [draftResult, ocrText] = await Promise.all([
      withObjectRetry("image", opts?.logger, () =>
        generateText({
          model,
          temperature: config.temperature,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt }, ...imageParts],
            },
          ],
          providerOptions: DRAFT_PROVIDER_OPTIONS,
          output: Output.object({ schema: SightDraftSchema }),
        }),
      ),
      ocrEnabled
        ? extractImageOcr(input.images, config.apiKey, config.model).catch(
            (error) => {
              console.warn(
                `[ocr] extraction failed, omitting extracted text: ${error instanceof Error ? error.message : String(error)}`,
              );
              return null;
            },
          )
        : Promise.resolve(null),
    ]);
    assertDraftNotBlocked(draftResult.finishReason);
    const { output } = draftResult;
    // output.excerpt (optional) is read by toGeminiOutput directly; a missing
    // one gets the central first-sentence fallback in post-writer.
    const result = toGeminiOutput(output, "SIGHT", {
      imageAlts: output.imageAlts,
    });
    // Non-null OCR text becomes embeddable/searchable: appended to the body as
    // an "Extracted text" section and recorded in frontmatter.ocr_text. Empty
    // (null) results leave the post untouched.
    if (ocrText) {
      const appended = `${result.body.trimEnd()}\n\n---\n\n**Extracted text:**\n\n${ocrText}\n`;
      result.body = appended;
      result.rawMdx = appended;
      result.frontmatter.ocr_text = ocrText;
    }
    return result;
  }

  // Document kind: try the dedicated structured runner first (PDF structure
  // extraction / DOCX via mammoth → second structuring call). On throw or null
  // it falls through to the shared direct-Gemini-file approach below so prior
  // behavior is preserved (and DOCX, which Gemini can't natively read, still
  // gets a fallback attempt).
  if (input.kind === "document") {
    try {
      const result = await runDocumentGemini(input);
      if (result) {
        return result;
      }
    } catch (error) {
      console.warn(
        `[document] dedicated path failed, falling back to direct Gemini file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (
    input.kind === "video" ||
    input.kind === "audio" ||
    input.kind === "document"
  ) {
    if (!existsSync(input.stagedFilePath)) {
      throw new Error(`staged file not found: ${input.stagedFilePath}`);
    }
    const fileData = readFileSync(input.stagedFilePath);
    const forcedTypes: Record<string, PostType> = {
      video: "SIGHT",
      audio: "BLOG",
      document: "FINDING",
    };
    const forcedType = forcedTypes[input.kind] as PostType;
    // Gemini natively reads pdf/audio/video via a `file` content part. The
    // mediaType must be a `${string}/${string}` template literal type.
    const filePart = {
      type: "file" as const,
      data: fileData,
      mediaType: input.mimeType as `${string}/${string}`,
    };
    const { output, finishReason } = await withObjectRetry(
      input.kind,
      opts?.logger,
      () =>
        generateText({
          model,
          temperature: config.temperature,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt }, filePart],
            },
          ],
          providerOptions: DRAFT_PROVIDER_OPTIONS,
          output: Output.object({ schema: PostDraftSchema }),
        }),
    );
    assertDraftNotBlocked(finishReason);
    return toGeminiOutput(output, forcedType);
  }

  const { output, finishReason } = await withObjectRetry(
    "note",
    opts?.logger,
    () =>
      generateText({
        model,
        temperature: config.temperature,
        prompt,
        providerOptions: DRAFT_PROVIDER_OPTIONS,
        output: Output.object({ schema: PostDraftSchema }),
      }),
  );
  assertDraftNotBlocked(finishReason);
  return toGeminiOutput(output, "BLOG");
}
