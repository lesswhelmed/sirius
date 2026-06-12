// Shared submit logic for URL/note and image ingest. Both the bearer-auth
// routes (used by the iOS Shortcut) and the session-auth routes (used by the
// web composer) call into here so the dedup hash, staging, and createSubmission
// contract live in one place.
import { randomUUID } from "node:crypto";
import { createSubmission, getProject, type IngestSubmission } from "@repo/db";
import {
  SightDraftEnvelopeSchema,
  type SightDraftEnvelope,
} from "@repo/ingest-draft";

import { contentHashForBytes, contentHashForUrls } from "./hash";
import { heicToJpeg, isHeicExtension } from "./heic";
import { sniffImageFormat } from "./image-format";
import {
  extensionForContentType,
  extensionForFileMime,
  fileMetadataSchema,
  imageMetadataSchema,
  urlIngestSchema,
  type FileIngestMetadata,
} from "./schema";
import { stageBytes } from "./staging";

type Logger = (
  level: "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>
) => void;

// Validates that the submitter owns the project before we persist it onto the
// submission. Returns null (never throws) when there's no submitter, no
// projectId, or the project isn't owned by the submitter.
async function validateProjectOwnership(
  submittedById: string | null,
  projectId: string | null
): Promise<string | null> {
  if (!projectId || !submittedById) {
    return null;
  }
  const project = await getProject(submittedById, projectId);
  return project ? projectId : null;
}

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
      // 400 = bad request (validation); 422 = a HEIC/HEIF upload we accepted but
      // could not transcode to a servable JPEG (hard reject — see submitImageIngest).
      status: 400 | 422;
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
  submittedById: string | null = null,
  projectId: string | null = null
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
  // Dedup identity is the SOURCE content (urls + notes), never the draft: the
  // same note submitted with and without an on-device draft is the same note,
  // and outbox retries from mobile stay idempotent. `force` is the escape
  // hatch for intentional regeneration.
  const contentHash = contentHashForUrls(urls, notes, force);

  // Drafts are honored for notes and for SINGLE-url submissions (the client
  // drafts from /api/app/extract's summary — the extraction/generation split).
  // Multi-url batches still go through the worker's url_context fetch, which
  // is the only path that folds several pages into one post.
  let draft = parsed.data.draft;
  if (draft && kind === "url" && urls.length > 1) {
    log("warn", "draft-ignored-for-multi-url", { urlCount: urls.length });
    draft = undefined;
  }

  // seam(intake): validate projectId ownership before persisting. Drop to null
  // if there's no submitter, no projectId, or the project isn't owned by them.
  const validatedProjectId = await validateProjectOwnership(
    submittedById,
    projectId
  );

  log("info", "received", {
    kind,
    urlCount: urls.length,
    notesLength: notes.length,
    force,
    drafted: Boolean(draft),
    submittedById,
    projectId: validatedProjectId,
  });

  const result = await createSubmission({
    kind,
    payload: { urls, notes, force, ...(draft ? { draft } : {}) },
    contentHash,
    submittedById,
    projectId: validatedProjectId,
    // Also persist on the row so a reclaimed/retried job regenerates instead of
    // reusing an existing post (worker idempotency guard reads this column).
    force,
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
    projectId: string;
    // JSON-encoded SightDraftEnvelope ("" when absent) — multipart fields are
    // strings; validated in submitImageIngest.
    draft: string;
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
    projectId: form.get("projectId") ?? "",
    draft: form.get("draft") ?? "",
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
    projectId: get("projectId"),
    draft: get("draft"),
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
  submittedById: string | null = null,
  projectId: string | null = null
): Promise<SubmitResult> {
  const submissionId = randomUUID();

  // Dedup hash is computed from the ORIGINAL uploaded bytes and must stay so:
  // hashing post-conversion JPEG would (a) drift across libheif/sharp bumps and
  // (b) re-ingest already-stored photos as "new". Conversion only affects the
  // staged file + persisted contentType/extension, never the hash input.
  const contentHash = contentHashForBytes(payload.bytes);

  // Don't trust the client Content-Type alone: iOS Shortcuts / curl / share
  // sheets often send application/octet-stream or image/heic-sequence, which
  // would map to "bin" and skip HEIC conversion — staging a raw, unservable
  // file. Sniff the actual bytes and let that win when the header is useless.
  let bytes = payload.bytes;
  let contentType = payload.contentType;
  let ext = extensionForContentType(contentType);
  const sniffed = sniffImageFormat(payload.bytes);
  if (ext === "bin" && sniffed) {
    ext = sniffed.ext;
    contentType = sniffed.contentType;
  }

  // HEIC/HEIF can't be rendered by mobile (expo-image) or our catalog/library
  // <img> cards, so transcode to JPEG at the single submit choke point (covers
  // the bearer iOS-Shortcut path too, which has no client to convert). sharp
  // can't decode HEIC on this stack — heicToJpeg uses heic-convert.
  if (isHeicExtension(ext)) {
    try {
      const jpeg = await heicToJpeg(payload.bytes);
      bytes = new Uint8Array(jpeg);
      contentType = "image/jpeg";
      ext = "jpg";
    } catch (err) {
      // Hard reject: never stage an unservable .heic. The caller (iOS Shortcut /
      // app) gets a 422 so the failure is visible rather than silently broken.
      const message = err instanceof Error ? err.message : String(err);
      log("error", "heic-convert-failed", {
        batchId: payload.metadata.batchId,
        imageIndex: payload.metadata.imageIndex,
        contentType: payload.contentType,
        error: message,
      });
      return {
        ok: false,
        status: 422,
        error: "could not convert HEIC image to a servable format",
      };
    }
  }

  // After header + byte sniffing + HEIC transcode, a still-unknown extension
  // means the bytes are not a raster format we can serve (TIFF, corrupt, a
  // mislabeled non-image). Reject loudly instead of staging an unservable /N.bin
  // that renders broken on every client.
  if (ext === "bin") {
    log("error", "unservable-image", {
      batchId: payload.metadata.batchId,
      imageIndex: payload.metadata.imageIndex,
      contentType: payload.contentType,
      bytes: payload.bytes.byteLength,
    });
    return {
      ok: false,
      status: 422,
      error: "unsupported image format",
    };
  }

  const stagedFilePath = await stageBytes(submissionId, bytes, ext);

  // On-device SIGHT draft (JSON string form field). Soft-fail: an unparsable
  // or invalid draft is dropped with a warn — the image still ingests and the
  // worker's Gemini stage drafts it instead.
  let draft: SightDraftEnvelope | undefined;
  if (payload.metadata.draft) {
    try {
      const parsedDraft = SightDraftEnvelopeSchema.safeParse(
        JSON.parse(payload.metadata.draft)
      );
      if (parsedDraft.success) {
        draft = parsedDraft.data;
      } else {
        log("warn", "draft-invalid", {
          batchId: payload.metadata.batchId,
          issues: parsedDraft.error.issues.map((i) => ({
            path: i.path,
            code: i.code,
          })),
        });
      }
    } catch {
      log("warn", "draft-unparsable", { batchId: payload.metadata.batchId });
    }
  }

  // seam(intake): validate projectId ownership before persisting. Drop to null
  // if there's no submitter, no projectId, or the project isn't owned by them.
  const validatedProjectId = await validateProjectOwnership(
    submittedById,
    projectId
  );

  log("info", "received", {
    batchId: payload.metadata.batchId,
    imageIndex: payload.metadata.imageIndex,
    totalCount: payload.metadata.totalCount,
    contentType,
    originalContentType: payload.contentType,
    bytes: bytes.byteLength,
    drafted: Boolean(draft),
    submittedById,
    projectId: validatedProjectId,
  });

  const result = await createSubmission({
    kind: "image",
    payload: {
      notes: payload.metadata.notes,
      // Post-conversion values: the worker reconstructs the served extension
      // from payload.extension, so this must reflect the staged JPEG, not HEIC.
      contentType,
      extension: ext,
      ...(draft ? { draft } : {}),
    },
    contentHash,
    batchId: payload.metadata.batchId,
    imageIndex: payload.metadata.imageIndex,
    totalCount: payload.metadata.totalCount,
    stagedFilePath,
    submittedById,
    projectId: validatedProjectId,
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

// ── Generic single-file ingest (video/audio/document) ────────────────────────
// Mirrors the image path but for the reference-only file kinds. Each file is a
// single submission (no batching), staged to disk, and claimed by the worker as
// a non-image row. The bytes are never served — the worker feeds them to Gemini
// and deletes the staged file after processing.

export interface ParsedFilePayload {
  bytes: Uint8Array;
  contentType: string;
  metadata: FileIngestMetadata;
  fileName: string;
}

export async function parseMultipartFile(
  request: Request
): Promise<ParsedFilePayload | { error: string }> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return { error: "missing file field" };
  }
  const metaParsed = fileMetadataSchema.safeParse({
    kind: form.get("kind"),
    notes: form.get("notes") ?? "",
    projectId: form.get("projectId") ?? "",
  });
  if (!metaParsed.success) {
    return { error: `metadata validation failed: ${metaParsed.error.message}` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    return { error: "empty file body" };
  }
  return {
    bytes,
    contentType: file.type || "application/octet-stream",
    metadata: metaParsed.data,
    fileName: file.name,
  };
}

export async function parseRawFile(
  request: Request
): Promise<ParsedFilePayload | { error: string }> {
  const url = new URL(request.url);
  const get = (key: string) =>
    request.headers.get(`x-${key.toLowerCase()}`) ??
    url.searchParams.get(key) ??
    "";
  const metaParsed = fileMetadataSchema.safeParse({
    kind: get("kind"),
    notes: get("notes"),
    projectId: get("projectId"),
  });
  if (!metaParsed.success) {
    return { error: `metadata validation failed: ${metaParsed.error.message}` };
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) {
    return { error: "empty file body" };
  }
  return {
    bytes: new Uint8Array(buf),
    contentType:
      request.headers.get("content-type") ?? "application/octet-stream",
    metadata: metaParsed.data,
    fileName: get("filename") || `upload.${get("kind") || "bin"}`,
  };
}

export async function submitFileIngest(
  payload: ParsedFilePayload,
  log: Logger,
  submittedById: string | null = null,
  projectId: string | null = null
): Promise<SubmitResult> {
  const submissionId = randomUUID();
  const ext = extensionForFileMime(payload.contentType);
  const stagedFilePath = await stageBytes(submissionId, payload.bytes, ext);
  const contentHash = contentHashForBytes(payload.bytes);

  // seam(intake): validate projectId ownership before persisting. Drop to null
  // if there's no submitter, no projectId, or the project isn't owned by them.
  const validatedProjectId = await validateProjectOwnership(
    submittedById,
    projectId
  );

  log("info", "received", {
    kind: payload.metadata.kind,
    contentType: payload.contentType,
    bytes: payload.bytes.byteLength,
    fileName: payload.fileName,
    submittedById,
    projectId: validatedProjectId,
  });

  const result = await createSubmission({
    kind: payload.metadata.kind,
    payload: {
      notes: payload.metadata.notes,
      contentType: payload.contentType,
      extension: ext,
      fileName: payload.fileName,
    },
    contentHash,
    stagedFilePath,
    submittedById,
    projectId: validatedProjectId,
  });

  log("info", result.status === "created" ? "accepted" : "deduped", {
    id: result.submission.id,
    kind: payload.metadata.kind,
    status: result.submission.status,
  });

  return {
    ok: true,
    status: result.status === "created" ? 202 : 200,
    body: toBody(result.submission, result.status === "deduped"),
  };
}
