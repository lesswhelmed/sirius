// Over-the-weekly-limit fallback: when a free user has spent their free server
// AI generations, the worker must NOT call Gemini — but the ingest must still
// succeed as a great BOOKMARK (never silently fail). The stub body carries the
// user's OWN material verbatim (notes / source link / filename) instead of a
// canned placeholder, so search, the embedding, and on-device ask-my-posts all
// index REAL content. No upgrade copy lives in the body — the durable
// Post.aiTreatment="stub" marker drives the badge + upgrade CTA + "Regenerate
// with AI" in UI chrome, and a Pro regeneration rewrites this post in place.
// The shape is identical to a real draft (GeminiOutput) so writePost persists
// it with no special-casing, except the caller passes { status: DRAFT,
// aiTreatment: "stub" } so it lands unpublished and marked.
//
// Type is forced from the submission kind exactly like runGemini does.

import type { PostType } from "@repo/db";
import type { PostDraft } from "@repo/ingest-draft";
import { toGeminiOutput } from "./gemini-runner";
import type { GeminiOutput, PipelineInput } from "./types";

const FORCED_TYPE: Record<string, PostType> = {
  url: "FINDING",
  note: "BLOG",
  image: "SIGHT",
  video: "SIGHT",
  audio: "BLOG",
  document: "FINDING",
};

function firstLine(text: string, fallback: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return fallback;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function titleFor(input: PipelineInput): string {
  switch (input.kind) {
    case "url": {
      const host = input.urls[0] ? hostOf(input.urls[0]) : null;
      return host ? `Link from ${host}` : "Saved link";
    }
    case "note":
      return firstLine(input.notes, "Untitled note");
    case "image":
      return firstLine(input.notes, "Untitled photos");
    default: {
      const name = input.submission.originalFilename;
      if (name && name.trim()) return stripExtension(name.trim());
      const label: Record<string, string> = {
        video: "Untitled video",
        audio: "Untitled recording",
        document: "Untitled document",
      };
      return label[input.kind] ?? "Untitled";
    }
  }
}

// The bookmark body: the user's own words first (notes verbatim), plus a
// filename line for binary kinds whose content we can't show without AI.
// toGeminiOutput requires a non-empty body, so an empty capture falls back to
// a single neutral line (still no upsell copy — chrome handles that).
function bodyFor(input: PipelineInput): string {
  const notes = input.notes.trim();
  const parts: string[] = [];
  if (notes) {
    parts.push(notes);
  }
  if (
    input.kind === "video" ||
    input.kind === "audio" ||
    input.kind === "document"
  ) {
    const name = input.submission.originalFilename?.trim();
    if (name) {
      parts.push(`*Original file: ${name}*`);
    }
  }
  if (parts.length === 0) {
    parts.push("Saved for later.");
  }
  return parts.join("\n\n");
}

export function buildManualStub(input: PipelineInput): GeminiOutput {
  const title = titleFor(input);
  const draft: PostDraft = {
    title,
    slug: "",
    body: bodyFor(input),
    tags: [],
    categories: [],
  };
  const forcedType = FORCED_TYPE[input.kind] ?? "BLOG";
  // For url kind, preserve the source link in the body via toGeminiOutput's
  // Source:/YouTubeEmbed handling, exactly like the drafted path.
  // verbatimBody: the stub body is the user's own words — exempt from the
  // collapsed-markdown repair, which is for model output only.
  if (input.kind === "url" && input.urls[0]) {
    return toGeminiOutput(draft, forcedType, {
      originalUrl: input.urls[0],
      verbatimBody: true,
    });
  }
  return toGeminiOutput(draft, forcedType, { verbatimBody: true });
}
