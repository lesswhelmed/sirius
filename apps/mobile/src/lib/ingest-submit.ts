// Low-level ingest submission primitives shared by the composer and the share
// target. These mirror the worker's expectations: each URL becomes its own
// submission (so the dedicated IG / YouTube paths fire per-URL) and images are
// sent as a single batch keyed by one `batchId`.
import * as Crypto from "expo-crypto";

import { ApiError, apiPostForm, apiPostJson } from "@/lib/api";

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
  force = false
): Promise<SubmitOk> {
  return apiPostJson<SubmitOk>("/api/app/ingest", {
    urls: [url],
    notes,
    force,
  });
}

export function submitNote(notes: string, force = false): Promise<SubmitOk> {
  return apiPostJson<SubmitOk>("/api/app/ingest", {
    urls: [],
    notes,
    force,
  });
}

// Submits a set of images as one SIGHT batch. Each image is posted
// individually with a shared batchId/totalCount so the worker can wait for the
// whole batch before drafting. Per-image failures are reported via onError but
// don't abort the rest of the batch.
export async function submitImageBatch(
  images: ImageInput[],
  notes: string,
  onError?: (label: string, err: unknown) => void
): Promise<{ submitted: number }> {
  if (images.length === 0) {
    return { submitted: 0 };
  }
  const batchId = Crypto.randomUUID();
  let submitted = 0;
  for (let i = 0; i < images.length; i++) {
    const image = images[i]!;
    const form = new FormData();
    // RN FormData accepts { uri, name, type } as a "file" part.
    form.append("image", {
      uri: image.uri,
      name: image.name,
      type: image.type,
    } as unknown as Blob);
    form.append("batchId", batchId);
    form.append("imageIndex", String(i));
    form.append("totalCount", String(images.length));
    form.append("notes", notes);
    try {
      await apiPostForm<SubmitOk>("/api/app/ingest-images", form);
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
