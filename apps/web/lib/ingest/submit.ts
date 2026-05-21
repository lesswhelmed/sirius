// Shared submit logic for URL/note and image ingest. Both the bearer-auth
// routes (used by the iOS Shortcut) and the session-auth routes (used by the
// web composer) call into here so the dedup hash, staging, and createSubmission
// contract live in one place.
import { randomUUID } from "node:crypto";
import { createSubmission, type IngestSubmission } from "@repo/db";

import { contentHashForBytes, contentHashForUrls } from "./hash";
import {
  extensionForContentType,
  imageMetadataSchema,
  urlIngestSchema,
} from "./schema";
import { stageBytes } from "./staging";

type Logger = (
  level: "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>
) => void;

export type SubmitResultBody = {
  id: string;
  kind: string;
  status: string;
  deduped: boolean;
  batchId?: string | null;
  imageIndex?: number | null;
  totalCount?: number | null;
};

export type SubmitResult =
  | { ok: true; status: 200 | 202; body: SubmitResultBody }
  | {
      ok: false;
      status: 400;
      error: string;
      extra?: Record<string, unknown>;
    };

function toBody(
  submission: IngestSubmission,
  deduped: boolean
): SubmitResultBody {
  return {
    id: submission.id,
    kind: submission.kind,
    status: submission.status,
    deduped,
    batchId: submission.batchId,
    imageIndex: submission.imageIndex,
    totalCount: submission.totalCount,
  };
}

export async function submitUrlIngest(
  raw: unknown,
  log: Logger,
  submittedById: string | null = null
): Promise<SubmitResult> {
  const parsed = urlIngestSchema.safeParse(raw);
  if (!parsed.success) {
    log("warn", "validation-failed", {
      issues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })),
    });
    return {
      ok: false,
      status: 400,
      error: "validation failed",
      extra: { issues: parsed.error.issues },
    };
  }

  const { urls, notes, force } = parsed.data;
  const kind = urls.length > 0 ? "url" : "note";
  const contentHash = contentHashForUrls(urls, notes, force);
  log("info", "received", {
    kind,
    urlCount: urls.length,
    notesLength: notes.length,
    force,
    submittedById,
  });

  const result = await createSubmission({
    kind,
    payload: { urls, notes, force },
    contentHash,
    submittedById,
  });

  log("info", result.status === "created" ? "accepted" : "deduped", {
    id: result.submission.id,
    kind,
    status: result.submission.status,
  });

  return {
    ok: true,
    status: result.status === "created" ? 202 : 200,
    body: toBody(result.submission, result.status === "deduped"),
  };
}

export interface ParsedImagePayload {
  bytes: Uint8Array;
  contentType: string;
  metadata: {
    batchId: string;
    imageIndex: number;
    totalCount: number;
    notes: string;
  };
}

export async function parseMultipartImage(
  request: Request
): Promise<ParsedImagePayload | { error: string }> {
  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File)) {
    return { error: "missing image file field" };
  }
  const metaParsed = imageMetadataSchema.safeParse({
    batchId: form.get("batchId"),
    imageIndex: form.get("imageIndex"),
    totalCount: form.get("totalCount"),
    notes: form.get("notes") ?? "",
  });
  if (!metaParsed.success) {
    return { error: `metadata validation failed: ${metaParsed.error.message}` };
  }
  const bytes = new Uint8Array(await image.arrayBuffer());
  return {
    bytes,
    contentType: image.type || "application/octet-stream",
    metadata: metaParsed.data,
  };
}

export async function parseRawImage(
  request: Request
): Promise<ParsedImagePayload | { error: string }> {
  const url = new URL(request.url);
  const get = (key: string) =>
    request.headers.get(`x-${key.toLowerCase()}`) ??
    url.searchParams.get(key) ??
    "";
  const metaParsed = imageMetadataSchema.safeParse({
    batchId: get("batchId"),
    imageIndex: get("imageIndex"),
    totalCount: get("totalCount"),
    notes: get("notes"),
  });
  if (!metaParsed.success) {
    return { error: `metadata validation failed: ${metaParsed.error.message}` };
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) {
    return { error: "empty image body" };
  }
  return {
    bytes: new Uint8Array(buf),
    contentType:
      request.headers.get("content-type") ?? "application/octet-stream",
    metadata: metaParsed.data,
  };
}

export async function submitImageIngest(
  payload: ParsedImagePayload,
  log: Logger,
  submittedById: string | null = null
): Promise<SubmitResult> {
  const submissionId = randomUUID();
  const ext = extensionForContentType(payload.contentType);
  const stagedFilePath = await stageBytes(submissionId, payload.bytes, ext);
  const contentHash = contentHashForBytes(payload.bytes);

  log("info", "received", {
    batchId: payload.metadata.batchId,
    imageIndex: payload.metadata.imageIndex,
    totalCount: payload.metadata.totalCount,
    contentType: payload.contentType,
    bytes: payload.bytes.byteLength,
    submittedById,
  });

  const result = await createSubmission({
    kind: "image",
    payload: {
      notes: payload.metadata.notes,
      contentType: payload.contentType,
      extension: ext,
    },
    contentHash,
    batchId: payload.metadata.batchId,
    imageIndex: payload.metadata.imageIndex,
    totalCount: payload.metadata.totalCount,
    stagedFilePath,
    submittedById,
  });

  log("info", result.status === "created" ? "accepted" : "deduped", {
    id: result.submission.id,
    batchId: result.submission.batchId,
    imageIndex: result.submission.imageIndex,
    totalCount: result.submission.totalCount,
    status: result.submission.status,
  });

  return {
    ok: true,
    status: result.status === "created" ? 202 : 200,
    body: toBody(result.submission, result.status === "deduped"),
  };
}
