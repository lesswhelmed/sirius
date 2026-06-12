// On-device drafting: turn raw note text into a PostDraft with the local LLM,
// wrapped in the wire envelope the server validates. Mirrors the worker's
// note→BLOG prompt voice so an on-device draft reads like a Gemini draft.
// Every failure path returns null — the caller submits without a draft and the
// worker's Gemini stage picks it up, so local drafting can only ever improve
// privacy/latency, never lose a capture.
//
// Drafts are generated with generateObject(schema), but the prompt ALSO spells
// out the JSON shape and experimental_repairText extracts the object from any
// surrounding prose/fences: llama.rn 0.11.x silently drops the json_schema
// grammar when driven through @react-native-ai/llama@0.12 (peer range is
// llama.rn ^0.10.1), so schema enforcement at the sampler can't be relied on.
// Verified on-device 2026-06-11; the prompt+repair belt stays harmless once
// the provider supports llama.rn 0.11+ and the grammar kicks in again.
import {
  type DraftEnvelope,
  PostDraftSchema,
  type SightDraftEnvelope,
  SightDraftSchema,
} from "@repo/ingest-draft";
import { generateObject } from "ai";

import { isModelReady, withPreparedModel } from "./engine";
import { VISION_MODEL_ID } from "./models";
import { getLlmSettings } from "./settings";

const DRAFT_TIMEOUT_MS = 180_000;

// Returns the first balanced JSON object in the text (tolerating prose
// preambles and ``` fences), with raw control characters inside string
// literals escaped — small local models routinely emit real newlines inside
// the multi-paragraph "body" value, which is invalid JSON. Used as
// generateObject's repairText so a near-miss reply still parses.
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  const out: string[] = [];
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        out.push(ch);
      } else if (ch === "\\") {
        escaped = true;
        out.push(ch);
      } else if (ch === '"') {
        inString = false;
        out.push(ch);
      } else if (ch === "\n") {
        out.push("\\n");
      } else if (ch === "\r") {
        out.push("\\r");
      } else if (ch === "\t") {
        out.push("\\t");
      } else {
        out.push(ch);
      }
      continue;
    }
    out.push(ch);
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return out.join("");
      }
    }
  }
  return null;
}

const repairText = async ({ text }: { text: string }) =>
  extractJsonObject(text);

const NOTE_JSON_INSTRUCTIONS = [
  "Respond with ONLY a JSON object — no commentary, no markdown fences.",
  "All four fields are REQUIRED. Shape:",
  "{",
  '  "title": "short, plainspoken title; no clickbait",',
  '  "body": "REQUIRED — the full 80-300 word post text written from the notes",',
  '  "tags": ["1-5 lowercase kebab-case tags"],',
  '  "categories": ["1-3 lowercase kebab-case categories"]',
  "}",
].join("\n");

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
    "",
    NOTE_JSON_INSTRUCTIONS,
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    try {
      // Queues behind any in-flight chat/draft generation; the timeout covers
      // the wait too, so a draft that waited it out bails instead of burning
      // another generation.
      const { object } = await withPreparedModel(
        settings.modelId,
        "draft",
        (model) => {
          if (controller.signal.aborted) {
            // Timed out while queued behind another generation.
            throw new Error("draft timed out waiting for the model");
          }
          return generateObject({
            model,
            schema: PostDraftSchema,
            prompt: buildNotePrompt(notes),
            temperature: 0.7,
            maxOutputTokens: 1024,
            abortSignal: controller.signal,
            experimental_repairText: repairText,
          });
        }
      );
      return {
        schemaVersion: 1,
        engine: `llama.rn:${settings.modelId}`,
        draftedAt: new Date().toISOString(),
        post: object,
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

const SIGHT_JSON_INSTRUCTIONS = [
  "Respond with ONLY a JSON object — no commentary, no markdown fences.",
  "All six fields are REQUIRED. Shape:",
  "{",
  '  "title": "2-5 word noun phrase naming the literal subject",',
  '  "body": "REQUIRED — the full 60-160 word post text describing the photo(s)",',
  '  "excerpt": "one plain declarative sentence summarizing the photo(s)",',
  '  "imageAlts": ["one short factual caption per photo, in order"],',
  '  "tags": ["1-5 lowercase kebab-case tags"],',
  '  "categories": ["1-3 lowercase kebab-case categories"]',
  "}",
].join("\n");

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
  lines.push("", SIGHT_JSON_INSTRUCTIONS);
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    try {
      const { object } = await withPreparedModel(
        VISION_MODEL_ID,
        "draft",
        (model) => {
          if (controller.signal.aborted) {
            // Timed out while queued behind another generation.
            throw new Error("draft timed out waiting for the model");
          }
          return generateObject({
            model,
            schema: SightDraftSchema,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: buildSightPrompt(imageUris.length, notes),
                  },
                  ...imageUris.map((uri) => ({
                    type: "file" as const,
                    mediaType: "image/jpeg",
                    data: uri,
                  })),
                ],
              },
            ],
            temperature: 0.7,
            maxOutputTokens: 1024,
            abortSignal: controller.signal,
            experimental_repairText: repairText,
          });
        }
      );
      if (object.imageAlts.length !== imageUris.length) {
        // The worker's post-writer tolerates a count mismatch (falls back to
        // the title), but a small VLM losing track of image order is a strong
        // signal the rest of the draft is unreliable too. Let Gemini do it.
        return null;
      }
      return {
        schemaVersion: 1,
        engine: `llama.rn:${VISION_MODEL_ID}`,
        draftedAt: new Date().toISOString(),
        post: object,
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
