// Over-the-weekly-limit fallback: when a free user has spent their 10 server
// AI generations this week, the worker must NOT call Gemini — but the ingest
// must still succeed (never silently fail). This builds a DRAFT stub post with
// no AI body so the user keeps their ingested material (and uploaded photos)
// and can write the post themselves in the editor. The shape is identical to a
// real draft (GeminiOutput) so writePost persists it with no special-casing,
// except the caller passes { status: DRAFT } so it lands unpublished.
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

const PLACEHOLDER_BODY =
  "> Draft saved. You've used your free AI generations for this week — " +
  "write this post yourself, or upgrade to Sirius AI Pro for unlimited drafts.";

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

export function buildManualStub(input: PipelineInput): GeminiOutput {
  const title = titleFor(input);
  const draft: PostDraft = {
    title,
    slug: "",
    body: PLACEHOLDER_BODY,
    tags: [],
    categories: [],
  };
  const forcedType = FORCED_TYPE[input.kind] ?? "BLOG";
  // For url kind, preserve the source link in the body via toGeminiOutput's
  // Source:/YouTubeEmbed handling, exactly like the drafted path.
  if (input.kind === "url" && input.urls[0]) {
    return toGeminiOutput(draft, forcedType, { originalUrl: input.urls[0] });
  }
  return toGeminiOutput(draft, forcedType);
}
