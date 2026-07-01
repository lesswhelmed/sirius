// Low-level ingest submission primitives shared by the composer and the share
// target. These mirror the worker's expectations: each URL becomes its own
// submission (so the dedicated IG / YouTube paths fire per-URL) and images are
// sent as a single batch keyed by one `batchId`.
import type { DraftEnvelope } from "@repo/ingest-draft";

import { ApiError, apiPostJson } from "@/lib/api";

// Read visibility for the resulting Post (composer choice). Matches the server's
// PostVisibility enum. Optional everywhere: omitted → the worker keeps PRIVATE.
// "GROUP" pairs with a non-empty shareGroupIds array (invariant enforced by the
// composer's AudienceValue): the post is shared only with those share groups.
export type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC" | "GROUP";

export type SubmitOk = {
  id: string;
  kind: string;
  status: string;
  deduped: boolean;
  // Server re-queued a previously-failed row for reprocessing (mutually
  // exclusive with `deduped`) — see apps/web/lib/ingest/submit.ts:114-146.
  // Optional: older deploys / non-ingest responses (e.g. binary upload paths)
  // may not set it.
  retried?: boolean;
  batchId?: string | null;
  imageIndex?: number | null;
  totalCount?: number | null;
};

export type ImageInput = {
  uri: string;
  name: string;
  type: string;
};

// Builds the exact /api/app/ingest JSON body for a single URL. Shared between
// the live submit below and the offline/optimistic outbox (materials.ts), so a
// queued item replays the identical request (including any on-device draft).
// Also used for `repo` materials — a repo is a URL submission (the worker's
// github.com detection routes it to the dedicated structure+key-files path).
// Mirrors noteIngestBody's shape/param order exactly.
export function urlIngestBody(
  url: string,
  notes = "",
  force = false,
  projectId?: string,
  draft?: DraftEnvelope,
  visibility?: Visibility,
  shareGroupIds?: string[],
): {
  urls: string[];
  notes: string;
  force: boolean;
  projectId?: string;
  visibility?: Visibility;
  shareGroupIds?: string[];
  draft?: DraftEnvelope;
} {
  return {
    urls: [url],
    notes,
    force,
    ...(projectId ? { projectId } : {}),
    ...(visibility ? { visibility } : {}),
    // Share groups apply only to a GROUP-visibility post; the server validates
    // ownership and drops them otherwise, but we keep the body tidy here too.
    ...(visibility === "GROUP" && shareGroupIds?.length
      ? { shareGroupIds }
      : {}),
    // Single-url submissions may carry an on-device draft built from the
    // /api/app/extract summary; the server only honors it for one URL.
    ...(draft ? { draft } : {}),
  };
}

export function submitUrl(
  url: string,
  notes = "",
  force = false,
  projectId?: string,
  draft?: DraftEnvelope,
  visibility?: Visibility,
  shareGroupIds?: string[],
): Promise<SubmitOk> {
  return apiPostJson<SubmitOk>(
    "/api/app/ingest",
    urlIngestBody(
      url,
      notes,
      force,
      projectId,
      draft,
      visibility,
      shareGroupIds,
    ) as Parameters<typeof apiPostJson>[1],
  );
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
  shareGroupIds?: string[],
): {
  urls: string[];
  notes: string;
  force: boolean;
  projectId?: string;
  visibility?: Visibility;
  shareGroupIds?: string[];
  draft?: DraftEnvelope;
} {
  return {
    urls: [],
    notes,
    force,
    ...(projectId ? { projectId } : {}),
    ...(visibility ? { visibility } : {}),
    ...(visibility === "GROUP" && shareGroupIds?.length
      ? { shareGroupIds }
      : {}),
    ...(draft ? { draft } : {}),
  };
}

export function submitNote(
  notes: string,
  force = false,
  projectId?: string,
  draft?: DraftEnvelope,
  visibility?: Visibility,
  shareGroupIds?: string[],
): Promise<SubmitOk> {
  return apiPostJson<SubmitOk>(
    "/api/app/ingest",
    // DraftEnvelope is JSON-shaped by construction; apiPostJson's recursive
    // Json type just can't prove it through the zod-inferred object type.
    noteIngestBody(
      notes,
      force,
      projectId,
      draft,
      visibility,
      shareGroupIds,
    ) as Parameters<typeof apiPostJson>[1],
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
