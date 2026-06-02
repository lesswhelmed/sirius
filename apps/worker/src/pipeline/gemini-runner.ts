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
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import { getAIConfig } from "../lib/ai-config";
import { parseInstagramUrl } from "../lib/instagram-url";
import { parseYouTubeUrl } from "../lib/youtube-url";
import { runInstagramGemini } from "./instagram/runner";
import type { GeminiOutput, PipelineInput, StagedImage } from "./types";
import { runYouTubeGemini } from "./youtube/runner";

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
    .describe("1-3 lowercase kebab-case categories"),
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
    .describe("1-3 lowercase kebab-case categories"),
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

function buildPrompt(input: PipelineInput): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "You are drafting a single post for a personal blog.",
    `Today's date: ${today}.`,
    "Voice: first-person, observational, concrete. 80-300 words.",
    "No marketing copy. No 'Here is' preambles. No code fences in the body.",
    "",
  ];

  if (input.kind === "url") {
    lines.push(
      "Use the url_context tool to fetch every URL below before drafting. Summarize what you found as a short FINDING — what's on the page, why it's worth noting, anything specific that surprised you. Cite any quoted phrases inline naturally.",
      "",
      "URLs:"
    );
    for (const url of input.urls) {
      lines.push(`  - ${url}`);
    }
    if (input.notes.trim()) {
      lines.push("", `Author's notes (verbatim): ${input.notes.trim()}`);
    }
  } else if (input.kind === "image") {
    lines.push(
      `${input.images.length} photo(s) are attached, in order. Write a SIGHT post about what is actually in them.`,
      "Title: a 2-5 word noun phrase naming the literal subject.",
      "Body: 60-160 words, first person, plain and concrete. Describe only what is visibly present — subject, setting, light, colors as plain names. Do NOT use intensifiers (almost, blinding, neon, aggressive), metaphor, simile, or mood-painting. Do NOT write image markdown, captions, or URLs in the body; the photos are shown separately by the app.",
      "Also return one short factual caption per photo in imageAlts, in the same order, and a one-sentence excerpt."
    );
    if (input.notes.trim()) {
      lines.push("", `Author's notes (verbatim): ${input.notes.trim()}`);
    }
  } else if (input.kind === "note") {
    lines.push(
      "Compose a short BLOG entry from the author's notes:",
      "",
      input.notes.trim()
    );
  } else {
    // video | audio | document — reference-only: describe/summarize the
    // attached file's content as text. No media is embedded in the post.
    const kindLabels: Record<string, string> = {
      video: "VIDEO",
      audio: "AUDIO RECORDING",
      document: "DOCUMENT",
    };
    const postTypes: Record<string, string> = {
      video: "SIGHT post (describe what you see/hear, the subject, the mood)",
      audio: "BLOG entry (transcribe key points, first-person observations)",
      document: "FINDING post (summarize the content, key claims, relevance)",
    };
    lines.push(
      `A ${kindLabels[input.kind] ?? input.kind} file is attached. Write a ${postTypes[input.kind] ?? "post"}.`,
      "Be concrete, first-person, observational. No filler. 80-300 words."
    );
    if (input.notes.trim()) {
      lines.push("", `Author's notes (verbatim): ${input.notes.trim()}`);
    }
  }
  return lines.join("\n");
}

function buildUrlStructuringPrompt(summary: string, notes: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "You are drafting a single FINDING post for a personal blog from a pre-fetched URL summary.",
    `Today's date: ${today}.`,
    "Voice: first-person, observational, concrete. 80-300 words.",
    "No marketing copy. No 'Here is' preambles. No code fences in the body.",
    "Summarize what's on the page, why it's worth noting, anything specific that surprised you. Cite any quoted phrases inline naturally.",
    "",
    "Pre-fetched URL summary:",
    summary,
  ];
  if (notes.trim()) {
    lines.push("", `Author's notes (verbatim): ${notes.trim()}`);
  }
  return lines.join("\n");
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
  opts?: { originalUrl?: string; excerpt?: string; imageAlts?: string[] }
): GeminiOutput {
  const title = draft.title.trim() || "Untitled Ingest";
  const slug = slugify(draft.slug?.trim() || title);
  const trimmedUrl = opts?.originalUrl?.trim() || "";
  const frontmatter: Record<string, unknown> = {
    title,
    type: forcedType,
    status: "DRAFT",
    published: false,
    date: new Date().toISOString().slice(0, 10),
    tags: draft.tags,
    categories: draft.categories,
    slug,
  };
  if (trimmedUrl) {
    frontmatter.original_url = trimmedUrl;
  }
  const excerpt = opts?.excerpt?.trim();
  if (excerpt) {
    frontmatter.excerpt = excerpt;
  }
  // Per-image alt text for the SIGHT gallery; post-writer pairs these with the
  // copied image URLs in order.
  if (opts?.imageAlts && opts.imageAlts.length > 0) {
    frontmatter.image_alts = opts.imageAlts;
  }
  const drafted = draft.body.trim();
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

export async function runGemini(input: PipelineInput): Promise<GeminiOutput> {
  const config = getAIConfig();
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
  const model = google(config.model);
  const prompt = buildPrompt(input);

  if (input.kind === "url") {
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
          `[instagram] dedicated path failed, falling back to url_context: ${error instanceof Error ? error.message : String(error)}`
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
          `[youtube] dedicated path failed, falling back to url_context: ${error instanceof Error ? error.message : String(error)}`
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
            `[youtube] response body: ${typeof e.responseBody === "string" ? e.responseBody : JSON.stringify(e.responseBody)}`
          );
        }
        if (e.data !== undefined) {
          console.warn(
            `[youtube] response data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}`
          );
        }
        if (e.cause !== undefined) {
          const cause = e.cause as { message?: unknown };
          console.warn(
            `[youtube] cause: ${cause?.message !== undefined ? String(cause.message) : JSON.stringify(e.cause)}`
          );
        }
      }
    }
    const { text: summary } = await generateText({
      model,
      tools: { url_context: google.tools.urlContext({}) },
      stopWhen: stepCountIs(4),
      temperature: config.temperature,
      prompt,
    });
    const { output } = await generateText({
      model,
      temperature: config.temperature,
      prompt: buildUrlStructuringPrompt(summary, input.notes),
      output: Output.object({ schema: PostDraftSchema }),
    });
    return toGeminiOutput(output, "FINDING", { originalUrl: input.urls[0] });
  }

  if (input.kind === "image") {
    const imageParts = input.images.map(loadImagePart);
    const { output } = await generateText({
      model,
      temperature: config.temperature,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...imageParts],
        },
      ],
      output: Output.object({ schema: SightDraftSchema }),
    });
    return toGeminiOutput(output, "SIGHT", {
      excerpt: output.excerpt,
      imageAlts: output.imageAlts,
    });
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
    const { output } = await generateText({
      model,
      temperature: config.temperature,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, filePart],
        },
      ],
      output: Output.object({ schema: PostDraftSchema }),
    });
    return toGeminiOutput(output, forcedType);
  }

  const { output } = await generateText({
    model,
    temperature: config.temperature,
    prompt,
    output: Output.object({ schema: PostDraftSchema }),
  });
  return toGeminiOutput(output, "BLOG");
}
