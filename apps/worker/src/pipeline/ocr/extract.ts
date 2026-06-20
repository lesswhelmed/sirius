// OCR pre-pass for image batches. Runs a dedicated text-extraction Gemini call
// over the same inline image parts the SIGHT draft uses, prompting for verbatim
// visible text in reading order. The result is appended to the post body and
// recorded in frontmatter.ocr_text so screenshot text becomes embeddable and
// searchable. Returns null when there's no text so we never pollute the body of
// a text-free photo. Called concurrently with the SIGHT draft (they're
// independent) — see the image branch in gemini-runner.ts.

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import type { StagedImage } from "../types";

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

function loadImagePart(staged: StagedImage) {
  return {
    type: "image" as const,
    image: readFileSync(staged.stagedFilePath),
    mediaType: mimeForImage(staged),
  };
}

const OCR_PROMPT = [
  "Extract all visible text from the attached image(s) verbatim, in natural reading order.",
  "Preserve line breaks where they aid readability. Do not summarize, translate, or add commentary.",
  "If there is no legible text at all, return an empty string.",
].join("\n");

export async function extractImageOcr(
  images: StagedImage[],
  apiKey: string,
  model: string,
): Promise<string | null> {
  if (images.length === 0) {
    return null;
  }
  const google = createGoogleGenerativeAI({ apiKey });
  const imageParts = images.map(loadImagePart);
  const { text } = await generateText({
    model: google(model),
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: OCR_PROMPT }, ...imageParts],
      },
    ],
  });
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}
