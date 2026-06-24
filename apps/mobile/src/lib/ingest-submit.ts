// Low-level ingest submission primitives shared by the composer and the share
// target. These mirror the worker's expectations: each URL becomes its own
// submission (so the dedicated IG / YouTube paths fire per-URL) and images are
// sent as a single batch keyed by one `batchId`.
import type { DraftEnvelope } from "@repo/ingest-draft";

import { ApiError, apiPostJson } from "@/lib/api";

// Read visibility for the resulting Post (composer choice). Matches the server's
// PostVisibility enum. Optional everywhere: omitted → the worker keeps PRIVATE.
export type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC";

export type SubmitOk = {
  id: string;
  kind: string;
  status: string;
  deduped: boolean;
  batchId?: string | null;
  imageIndex?: number | null;
  totalCount?: number | null;
};

export type ImageInput = {
  uri: string;
  name: string;
  type: string;
};

export function submitUrl(
  url: string,
  notes = "",
  force = false,
  projectId?: string,
  draft?: DraftEnvelope,
  visibility?: Visibility,
): Promise<SubmitOk> {
  return apiPostJson<SubmitOk>("/api/app/ingest", {
    urls: [url],
    notes,
    force,
    ...(projectId ? { projectId } : {}),
    ...(visibility ? { visibility } : {}),
    // Single-url submissions may carry an on-device draft built from the
    // /api/app/extract summary; the server only honors it for one URL.
    ...(draft ? { draft } : {}),
  } as Parameters<typeof apiPostJson>[1]);
}

// Fetches the de-identified URL summary from the extraction endpoint. Null on
// ANY failure (endpoint missing on older deploys, 401/429/502, offline, …) —
// callers fall back to the server-drafted path, never surface an error.
export async function fetchUrlExtract(urls: string[]): Promise<string | null> {
  try {
    const res = await apiPostJson<{ summary: string }>("/api/app/extract", {
      urls,
    });
    const summary = res.summary?.trim();
    return summary && summary.length > 0 ? summary : null;
  } catch {
    return null;
  }
}

// Builds the exact /api/app/ingest JSON body for a note. Shared between the
// live submit below and the offline outbox, so a queued item replays the
// identical request (including any on-device draft).
export function noteIngestBody(
  notes: string,
  force = false,
  projectId?: string,
  draft?: DraftEnvelope,
  visibility?: Visibility,
): {
  urls: string[];
  notes: string;
  force: boolean;
  projectId?: string;
  visibility?: Visibility;
  draft?: DraftEnvelope;
} {
  return {
    urls: [],
    notes,
    force,
    ...(projectId ? { projectId } : {}),
    ...(visibility ? { visibility } : {}),
    ...(draft ? { draft } : {}),
  };
}

export function submitNote(
  notes: string,
  force = false,
  projectId?: string,
  draft?: DraftEnvelope,
  visibility?: Visibility,
): Promise<SubmitOk> {
  return apiPostJson<SubmitOk>(
    "/api/app/ingest",
    // DraftEnvelope is JSON-shaped by construction; apiPostJson's recursive
    // Json type just can't prove it through the zod-inferred object type.
    noteIngestBody(notes, force, projectId, draft, visibility) as Parameters<
      typeof apiPostJson
    >[1],
  );
}

// Binary file kind for reference. Kept here (rather than outbox.ts) so
// callers that only know the kind don't need to import the full outbox module.
export type FileKind = "video" | "audio" | "document";

export function formatError(err: unknown, label: string): string {
  if (err instanceof ApiError)
    return `${label}: ${err.message} (${err.status})`;
  if (err instanceof Error) return `${label}: ${err.message}`;
  return `${label}: unknown error`;
}
