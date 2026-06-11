// Client-drafted ingest: when the mobile app drafted the post on-device (local
// LLM), the submission payload carries a draft envelope and the worker can skip
// its Gemini stage entirely. The envelope is re-validated here — submit-time
// validation already ran in apps/web, but stored JSON is never trusted — and
// any failure falls through to the normal Gemini path (return null), so a bad
// draft can only ever cost us a redundant Gemini call, never a broken post.
// The post TYPE is forced from the submission kind exactly like runGemini does;
// nothing in the client envelope can influence it.

import {
  DraftEnvelopeSchema,
  SightDraftEnvelopeSchema,
} from "@repo/ingest-draft";
import { toGeminiOutput } from "./gemini-runner";
import type { GeminiOutput, PipelineInput } from "./types";

export function tryClientDraft(input: PipelineInput): GeminiOutput | null {
  if (input.kind === "note") {
    if (input.draft == null) {
      return null;
    }
    const parsed = DraftEnvelopeSchema.safeParse(input.draft);
    if (!parsed.success) {
      console.warn(
        `[draft] invalid note draft envelope, falling back to Gemini: ${parsed.error.message}`
      );
      return null;
    }
    return toGeminiOutput(parsed.data.post, "BLOG");
  }

  if (input.kind === "image") {
    if (input.draft == null) {
      return null;
    }
    const parsed = SightDraftEnvelopeSchema.safeParse(input.draft);
    if (!parsed.success) {
      console.warn(
        `[draft] invalid sight draft envelope, falling back to Gemini: ${parsed.error.message}`
      );
      return null;
    }
    return toGeminiOutput(parsed.data.post, "SIGHT", {
      excerpt: parsed.data.post.excerpt,
      imageAlts: parsed.data.post.imageAlts,
    });
  }

  // url / video / audio / document never carry a usable draft: URLs require the
  // worker's url_context fetch, and file kinds upload bytes precisely because
  // the client did NOT process them locally.
  return null;
}
