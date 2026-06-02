// Low-level ingest submission primitives shared by the composer and the share
// target. These mirror the worker's expectations: each URL becomes its own
// submission (so the dedicated IG / YouTube paths fire per-URL) and images are
// sent as a single batch keyed by one `batchId`.
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
  projectId?: string
): Promise<SubmitOk> {
  return apiPostJson<SubmitOk>("/api/app/ingest", {
    urls: [url],
    notes,
    force,
    ...(projectId ? { projectId } : {}),
  });
}

export function submitNote(
  notes: string,
  force = false,
  projectId?: string
): Promise<SubmitOk> {
  return apiPostJson<SubmitOk>("/api/app/ingest", {
    urls: [],
    notes,
    force,
    ...(projectId ? { projectId } : {}),
  });
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
  projectId?: string
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
  projectId?: string
): Promise<{ submitted: number }> {
  if (images.length === 0) {
    return { submitted: 0 };
  }
  const batchId = Crypto.randomUUID();
  let submitted = 0;
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
        },
      });
      submitted++;
    } catch (err) {
      onError?.(`image ${i + 1}`, err);
    }
  }
  return { submitted };
}

export function formatError(err: unknown, label: string): string {
  if (err instanceof ApiError) return `${label}: ${err.message} (${err.status})`;
  if (err instanceof Error) return `${label}: ${err.message}`;
  return `${label}: unknown error`;
}
