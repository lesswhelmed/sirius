// Builds the owner-only "original capture" model for a post: the raw note text
// the user typed at ingest, plus any retained audio originals. This is the
// single source of truth for the shape both clients render — the web post page
// calls it directly (server component) and the mobile client fetches it through
// GET /api/app/posts/[slug]/original. Note text lives in IngestSubmission.payload
// (untyped Json), retained audio is the private-uploads file the worker kept.
import type { IngestSubmission } from "@repo/db";

export interface OriginalNote {
  submissionId: string;
  // The originating submission kind ("note" | "audio" | "url" | "image" | …).
  kind: string;
  // The raw note text the user typed at capture (whitespace preserved).
  text: string;
  // Any URLs submitted alongside the note.
  urls: string[];
}

export interface OriginalAudio {
  submissionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  // Server-relative URL that streams the retained file INLINE (Range-enabled) so
  // an <audio>/expo-audio element can play and seek it. Still owner-gated by the
  // route. Web uses it as-is; mobile prefixes the API host + attaches the cookie.
  src: string;
}

export interface OriginalContent {
  notes: OriginalNote[];
  audio: OriginalAudio[];
}

// Parse the raw notes/urls out of an untyped IngestSubmission.payload blob.
// Shared with the notes-as-text export route so the two can never disagree on
// what counts as "original note content".
export function rawNotesFor(payload: unknown): {
  notes: string;
  urls: string[];
} {
  const p =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { notes?: unknown; urls?: unknown })
      : {};
  return {
    notes: typeof p.notes === "string" ? p.notes.trim() : "",
    urls: Array.isArray(p.urls)
      ? (p.urls as unknown[]).filter((u): u is string => typeof u === "string")
      : [],
  };
}

export function buildOriginalContent(
  slug: string,
  submissions: IngestSubmission[],
): OriginalContent {
  const notes: OriginalNote[] = [];
  const audio: OriginalAudio[] = [];
  for (const sub of submissions) {
    const { notes: text, urls } = rawNotesFor(sub.payload);
    if (text || urls.length > 0) {
      notes.push({ submissionId: sub.id, kind: sub.kind, text, urls });
    }
    // An audio original is a retained file whose stored mime type is audio/*.
    if (
      sub.retainedFilePath &&
      (sub.originalMimeType ?? "").startsWith("audio/")
    ) {
      audio.push({
        submissionId: sub.id,
        filename: sub.originalFilename ?? "audio",
        mimeType: sub.originalMimeType as string,
        sizeBytes: sub.originalSizeBytes ?? null,
        src: `/api/app/posts/${encodeURIComponent(slug)}/source?submissionId=${encodeURIComponent(sub.id)}&disposition=inline`,
      });
    }
  }
  return { notes, audio };
}
