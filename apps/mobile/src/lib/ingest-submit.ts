// Low-level ingest submission primitives shared by the composer and the share
// target. These mirror the worker's expectations: each URL becomes its own
// submission (so the dedicated IG / YouTube paths fire per-URL) and images are
// sent as a single batch keyed by one `batchId`.
import type { DraftEnvelope } from "@repo/ingest-draft";
import * as Crypto from "expo-crypto";

import { ApiError, apiPostJson, uploadFile } from "@/lib/api";

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
): Promise<SubmitOk> {
  return apiPostJson<SubmitOk>("/api/app/ingest", {
    urls: [url],
    notes,
    force,
    ...(projectId ? { projectId } : {}),
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
): {
  urls: string[];
  notes: string;
  force: boolean;
  projectId?: string;
  draft?: DraftEnvelope;
} {
  return {
    urls: [],
    notes,
    force,
    ...(projectId ? { projectId } : {}),
    ...(draft ? { draft } : {}),
  };
}

export function submitNote(
  notes: string,
  force = false,
  projectId?: string,
  draft?: DraftEnvelope,
): Promise<SubmitOk> {
  return apiPostJson<SubmitOk>(
    "/api/app/ingest",
    // DraftEnvelope is JSON-shaped by construction; apiPostJson's recursive
    // Json type just can't prove it through the zod-inferred object type.
    noteIngestBody(notes, force, projectId, draft) as Parameters<
      typeof apiPostJson
    >[1],
  );
}

// Submits a single non-image file (video/audio/document) as one submission.
// Mirrors submitImageBatch's per-file upload but targets the generic
// file-ingest endpoint; the worker forces the PostType per kind.
export type FileKind = "video" | "audio" | "document";

export async function submitFile(
  fileUri: string,
  kind: FileKind,
  mimeType: string,
  fileName: string,
  notes = "",
  projectId?: string,
): Promise<SubmitOk> {
  return uploadFile<SubmitOk>("/api/app/ingest-file", fileUri, {
    fieldName: "file",
    mimeType,
    parameters: {
      kind,
      notes,
      ...(projectId ? { projectId } : {}),
    },
  });
}

// Submits a set of images as one SIGHT batch. Each image is posted
// individually with a shared batchId/totalCount so the worker can wait for the
// whole batch before drafting. Per-image failures are reported via onError but
// don't abort the rest of the batch.
export async function submitImageBatch(
  images: ImageInput[],
  notes: string,
  onError?: (label: string, err: unknown) => void,
  projectId?: string,
  // JSON-encoded SightDraftEnvelope from on-device drafting. Sent on EVERY row
  // (mirroring notes) so the worker's rows[0] read works regardless of which
  // row it claims first.
  draftJson?: string,
): Promise<{ submitted: number; failedIndices: number[]; batchId: string }> {
  if (images.length === 0) {
    return { submitted: 0, failedIndices: [], batchId: "" };
  }
  const batchId = Crypto.randomUUID();
  let submitted = 0;
  const failedIndices: number[] = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i]!;
    try {
      await uploadFile<SubmitOk>("/api/app/ingest-images", image.uri, {
        fieldName: "image",
        mimeType: image.type,
        parameters: {
          batchId,
          imageIndex: String(i),
          totalCount: String(images.length),
          notes,
          ...(projectId ? { projectId } : {}),
          ...(draftJson ? { draft: draftJson } : {}),
        },
      });
      submitted++;
    } catch (err) {
      failedIndices.push(i);
      onError?.(`image ${i + 1}`, err);
    }
  }
  return { submitted, failedIndices, batchId };
}

export function formatError(err: unknown, label: string): string {
  if (err instanceof ApiError)
    return `${label}: ${err.message} (${err.status})`;
  if (err instanceof Error) return `${label}: ${err.message}`;
  return `${label}: unknown error`;
}
