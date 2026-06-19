// On-device drafting: turn raw note text into a PostDraft with the local LLM,
// wrapped in the wire envelope the server validates. Mirrors the worker's
// note→BLOG prompt voice so an on-device draft reads like a Gemini draft.
// Every failure path returns null — the caller submits without a draft and the
// worker's Gemini stage picks it up, so local drafting can only ever improve
// privacy/latency, never lose a capture.
//
// Drafts are generated with PLAIN generateText (no Output.object) and the
// prompt spells out the exact JSON shape; generateDraft then extracts the
// object from the free text. We deliberately do NOT ask the SDK for structured
// output: Output.object makes the AI SDK send a json response_format, which
// @react-native-ai/llama@0.12 forwards to llama.rn 0.12.4 as a schema-grammar —
// and on-device that constrained-sampling path returns an EMPTY completion
// (finishReason=stop, 0 tokens), so every draft failed with "No object
// generated" (verified on the iOS sim 2026-06-14). Dropping the grammar lets
// the model emit its normal prose-wrapped JSON, which extractJsonObject +
// schema.parse recover. (On llama.rn 0.11.x the grammar was instead silently
// dropped — fail-open to prose — so the same prompt+parse approach is what
// works across both versions.)
import {
  buildVoiceInstruction,
  type DraftEnvelope,
  PostDraftSchema,
  type SightDraftEnvelope,
  SightDraftSchema,
} from "@repo/ingest-draft";
import { generateText } from "ai";

import { checkNativeBridge, isModelReady, withPreparedModel } from "./engine";
import { ON_DEVICE_AI_ENABLED } from "./flag";
import { VISION_MODEL_ID } from "./models";
import { getLlmSettings } from "./settings";

const DRAFT_TIMEOUT_MS = 180_000;

// Returns the first balanced JSON object in the text (tolerating prose
// preambles and ``` fences), with raw control characters inside string
// literals escaped — small local models routinely emit real newlines inside
// the multi-paragraph "body" value, which is invalid JSON. Used by
// generateDraft to recover the object from the model's free-text reply.
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

// Awaits a plain generateText call and parses our draft object out of its free
// text: pull the first balanced JSON object from the reply (tolerating prose,
// ``` fences, and raw control chars) and validate it against the schema. Throws
// if the reply carries no JSON object or it fails validation — the caller turns
// any throw into a null draft and lets the worker's Gemini stage take over.
// schema is typed structurally on `.parse` so we avoid pulling zod's types in;
// T is pinned by both the schema and the promise.
async function generateDraft<T>(
  schema: { parse: (value: unknown) => T },
  pending: Promise<{ text: string }>,
): Promise<T> {
  const { text } = await pending;
  const repaired = extractJsonObject(text);
  if (!repaired) {
    throw new Error("on-device draft produced no JSON object in its output");
  }
  return schema.parse(JSON.parse(repaired));
}

const NOTE_JSON_INSTRUCTIONS = [
  "Respond with ONLY a JSON object — no commentary, no markdown fences.",
  "All four fields are REQUIRED. Shape:",
  "{",
  '  "title": "short, plainspoken title; no clickbait",',
  '  "body": "REQUIRED — the full post text. AT LEAST 120 words; expand the notes into 2-3 paragraphs of concrete first-person detail, do not summarize them into a single short paragraph",',
  '  "tags": ["1-5 lowercase kebab-case tags"],',
  '  "categories": ["1-3 lowercase kebab-case categories"]',
  "}",
].join("\n");

function buildNotePrompt(notes: string, voiceBlock: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "You are drafting a single post for a personal blog.",
    `Today's date: ${today}.`,
    "Voice: first-person, observational, concrete. 80-300 words.",
    "No marketing copy. No 'Here is' preambles. No code fences in the body.",
    "",
    "Compose a short BLOG entry from the author's notes:",
    "",
    notes.trim(),
  ];
  if (voiceBlock) {
    lines.push(voiceBlock);
  }
  lines.push("", NOTE_JSON_INSTRUCTIONS);
  return lines.join("\n");
}

// Returns true when the curation toggle is on AND the selected model is on
// disk. Used by the submit path to decide whether to draft at all.
export async function canDraftOnDevice(): Promise<boolean> {
  try {
    if (!ON_DEVICE_AI_ENABLED) {
      return false;
    }
    const settings = await getLlmSettings();
    if (!settings.onDeviceCuration) {
      return false;
    }
    if (!(await checkNativeBridge()).ok) {
      // Missing native bridge: drafting would throw on prepare() and the worker
      // would draft anyway. Skip the doomed attempt.
      return false;
    }
    return await isModelReady(settings.modelId);
  } catch {
    return false;
  }
}

export async function draftNotePost(
  notes: string,
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
      const post = await withPreparedModel(
        settings.modelId,
        "draft",
        (model) => {
          if (controller.signal.aborted) {
            // Timed out while queued behind another generation.
            throw new Error("draft timed out waiting for the model");
          }
          return generateDraft(
            PostDraftSchema,
            generateText({
              model,
              prompt: buildNotePrompt(
                notes,
                buildVoiceInstruction(settings.voiceProfile),
              ),
              temperature: 0.7,
              abortSignal: controller.signal,
            }),
          );
        },
      );
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
      `[llm] on-device draft failed, submitting without draft: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// FINDING voice for URL posts drafted from a server-fetched extract — adapted
// from the worker's buildUrlStructuringPrompt so an on-device URL draft reads
// like a Gemini one. The extract comes from /api/app/extract (de-identified);
// the author's notes only join here, on-device.
function buildUrlPrompt(
  summary: string,
  notes: string,
  voiceBlock: string,
): string {
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
  if (voiceBlock) {
    lines.push(voiceBlock);
  }
  lines.push("", NOTE_JSON_INSTRUCTIONS);
  return lines.join("\n");
}

// Drafts a FINDING post from a server-fetched URL extract. Same soft-fail
// contract as draftNotePost; the engine string marks the split provenance.
export async function draftUrlPost(
  summary: string,
  notes: string,
): Promise<DraftEnvelope | null> {
  try {
    if (!(await canDraftOnDevice())) {
      return null;
    }
    const settings = await getLlmSettings();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    try {
      const post = await withPreparedModel(
        settings.modelId,
        "draft",
        (model) => {
          if (controller.signal.aborted) {
            throw new Error("draft timed out waiting for the model");
          }
          return generateDraft(
            PostDraftSchema,
            generateText({
              model,
              prompt: buildUrlPrompt(
                summary,
                notes,
                buildVoiceInstruction(settings.voiceProfile),
              ),
              temperature: 0.7,
              abortSignal: controller.signal,
            }),
          );
        },
      );
      return {
        schemaVersion: 1,
        engine: `llama.rn:${settings.modelId}+server-extract`,
        draftedAt: new Date().toISOString(),
        post,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(
      `[llm] on-device url draft failed, submitting without draft: ${err instanceof Error ? err.message : String(err)}`,
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

function buildSightPrompt(
  imageCount: number,
  notes: string,
  voiceBlock: string,
): string {
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
  if (voiceBlock) {
    lines.push(voiceBlock);
  }
  lines.push("", SIGHT_JSON_INSTRUCTIONS);
  return lines.join("\n");
}

// True when SIGHT batches can be drafted on this device: curation on AND the
// vision model (weights + mmproj projector) is downloaded.
export async function canDraftSightOnDevice(): Promise<boolean> {
  try {
    if (!ON_DEVICE_AI_ENABLED) {
      return false;
    }
    const settings = await getLlmSettings();
    if (!settings.onDeviceCuration) {
      return false;
    }
    if (!(await checkNativeBridge()).ok) {
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
  notes: string,
): Promise<SightDraftEnvelope | null> {
  try {
    if (imageUris.length === 0 || !(await canDraftSightOnDevice())) {
      return null;
    }
    const settings = await getLlmSettings();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    try {
      const post = await withPreparedModel(
        VISION_MODEL_ID,
        "draft",
        (model) => {
          if (controller.signal.aborted) {
            // Timed out while queued behind another generation.
            throw new Error("draft timed out waiting for the model");
          }
          return generateDraft(
            SightDraftSchema,
            generateText({
              model,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: buildSightPrompt(
                        imageUris.length,
                        notes,
                        buildVoiceInstruction(settings.voiceProfile),
                      ),
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
              abortSignal: controller.signal,
            }),
          );
        },
      );
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
      `[llm] on-device sight draft failed, submitting without draft: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
