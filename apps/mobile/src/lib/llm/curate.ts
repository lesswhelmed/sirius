// On-device drafting: turn raw note text into a PostDraft with the local LLM,
// wrapped in the wire envelope the server validates. Mirrors the worker's
// note→BLOG prompt voice so an on-device draft reads like a Gemini draft.
// Every failure path returns null — the caller submits without a draft and the
// worker's Gemini stage picks it up, so local drafting can only ever improve
// privacy/latency, never lose a capture.
import {
  type DraftEnvelope,
  PostDraftSchema,
  type SightDraftEnvelope,
  SightDraftSchema,
} from "@repo/ingest-draft";
import { generateText, Output } from "ai";

import { getPreparedModel, isModelReady } from "./engine";
import { VISION_MODEL_ID } from "./models";
import { getLlmSettings } from "./settings";

const DRAFT_TIMEOUT_MS = 180_000;

function buildNotePrompt(notes: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "You are drafting a single post for a personal blog.",
    `Today's date: ${today}.`,
    "Voice: first-person, observational, concrete. 80-300 words.",
    "No marketing copy. No 'Here is' preambles. No code fences in the body.",
    "",
    "Compose a short BLOG entry from the author's notes:",
    "",
    notes.trim(),
  ].join("\n");
}

// Returns true when the curation toggle is on AND the selected model is on
// disk. Used by the submit path to decide whether to draft at all.
export async function canDraftOnDevice(): Promise<boolean> {
  try {
    const settings = await getLlmSettings();
    if (!settings.onDeviceCuration) {
      return false;
    }
    return await isModelReady(settings.modelId);
  } catch {
    return false;
  }
}

export async function draftNotePost(
  notes: string
): Promise<DraftEnvelope | null> {
  try {
    if (!(await canDraftOnDevice())) {
      return null;
    }
    const settings = await getLlmSettings();
    const model = await getPreparedModel(settings.modelId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    try {
      // Same structured-output pattern as the worker's gemini-runner.
      const { output } = await generateText({
        model,
        prompt: buildNotePrompt(notes),
        temperature: 0.7,
        abortSignal: controller.signal,
        output: Output.object({ schema: PostDraftSchema }),
      });
      // Output.object already validated against the schema; parse once more so
      // the envelope we ship is exactly what the server will accept.
      const post = PostDraftSchema.parse(output);
      return {
        schemaVersion: 1,
        engine: `llama.rn:${settings.modelId}`,
        draftedAt: new Date().toISOString(),
        post,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(
      `[llm] on-device draft failed, submitting without draft: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

function buildSightPrompt(imageCount: number, notes: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "You are drafting a single post for a personal blog.",
    `Today's date: ${today}.`,
    `${imageCount} photo(s) are attached, in order. Write a SIGHT post about what is actually in them.`,
    "Title: a 2-5 word noun phrase naming the literal subject.",
    "Body: 60-160 words, first person, plain and concrete. Describe only what is visibly present — subject, setting, light, colors as plain names. Do NOT use intensifiers (almost, blinding, neon, aggressive), metaphor, simile, or mood-painting. Do NOT write image markdown, captions, or URLs in the body; the photos are shown separately by the app.",
    "Also return one short factual caption per photo in imageAlts, in the same order, and a one-sentence excerpt.",
  ];
  if (notes.trim()) {
    lines.push("", `Author's notes (verbatim): ${notes.trim()}`);
  }
  return lines.join("\n");
}

// True when SIGHT batches can be drafted on this device: curation on AND the
// vision model (weights + mmproj projector) is downloaded.
export async function canDraftSightOnDevice(): Promise<boolean> {
  try {
    const settings = await getLlmSettings();
    if (!settings.onDeviceCuration) {
      return false;
    }
    return await isModelReady(VISION_MODEL_ID);
  } catch {
    return false;
  }
}

// Drafts a SIGHT post from local image files (file:// URIs) with the vision
// model. Same null-on-any-failure contract as draftNotePost: the images still
// upload either way, only the Gemini drafting stage is skipped when a valid
// draft rides along.
export async function draftSightPost(
  imageUris: string[],
  notes: string
): Promise<SightDraftEnvelope | null> {
  try {
    if (imageUris.length === 0 || !(await canDraftSightOnDevice())) {
      return null;
    }
    const model = await getPreparedModel(VISION_MODEL_ID);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    try {
      const { output } = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildSightPrompt(imageUris.length, notes) },
              ...imageUris.map((uri) => ({
                type: "file" as const,
                mediaType: "image/jpeg",
                data: uri,
              })),
            ],
          },
        ],
        temperature: 0.7,
        abortSignal: controller.signal,
        output: Output.object({ schema: SightDraftSchema }),
      });
      const post = SightDraftSchema.parse(output);
      if (post.imageAlts.length !== imageUris.length) {
        // The worker's post-writer tolerates a count mismatch (falls back to
        // the title), but a small VLM losing track of image order is a strong
        // signal the rest of the draft is unreliable too. Let Gemini do it.
        return null;
      }
      return {
        schemaVersion: 1,
        engine: `llama.rn:${VISION_MODEL_ID}`,
        draftedAt: new Date().toISOString(),
        post,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(
      `[llm] on-device sight draft failed, submitting without draft: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
