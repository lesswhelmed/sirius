// Request validators for the ingest endpoints. iOS Shortcuts ships scalars as
// strings (form fields, query params), so schemas coerce strings → arrays/numbers
// where the underlying field is typed.
import { DraftEnvelopeSchema } from "@repo/ingest-draft";
import { z } from "zod";

const urlList = z
  .union([z.array(z.string()), z.string()])
  .transform((value) => (Array.isArray(value) ? value : value.split(/\r?\n/)))
  .pipe(
    z
      .array(z.string().trim().min(1).url("each url must be a valid URL"))
      .min(0),
  );

const flexibleBoolean = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    return value.trim().toLowerCase() === "true";
  });

// Per-capture read visibility for the resulting Post. Literal union matches the
// PostVisibility enum. Multipart fields arrive as strings ("" when absent), so a
// blank/missing value coerces to undefined and the worker keeps PRIVATE. submit.ts
// additionally drops FRIENDS on the unattributed bearer path.
const flexibleVisibility = z.preprocess(
  (value) =>
    typeof value === "string" && value.length > 0 ? value : undefined,
  z.enum(["PRIVATE", "FRIENDS", "PUBLIC"]).optional(),
);

export const urlIngestSchema = z
  .object({
    urls: urlList.optional().default([]),
    notes: z.string().optional().default(""),
    force: flexibleBoolean.optional().default(false),
    projectId: z.string().optional().default(""),
    visibility: flexibleVisibility,
    // Optional client-supplied draft (on-device LLM). Only honored for
    // note-kind submissions — URLs always go through the worker's url_context
    // fetch, so a draft there is stripped at submit time.
    draft: DraftEnvelopeSchema.optional(),
  })
  .refine(
    (data) => data.urls.length > 0 || data.notes.trim().length > 0,
    "urls or notes required",
  );

export type UrlIngestInput = z.infer<typeof urlIngestSchema>;

export const imageMetadataSchema = z.object({
  batchId: z.string().trim().min(1, "batchId required"),
  imageIndex: z.coerce.number().int().min(0),
  totalCount: z.coerce.number().int().min(1),
  notes: z.string().optional().default(""),
  projectId: z.string().optional().default(""),
  visibility: flexibleVisibility,
  // JSON-encoded SightDraftEnvelope (multipart fields are strings) from
  // on-device drafting; parsed + validated in submitImageIngest. Sent on every
  // row of a batch, like notes.
  draft: z.string().optional().default(""),
});

export type ImageIngestMetadata = z.infer<typeof imageMetadataSchema>;

const TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
};

export function extensionForContentType(contentType: string): string {
  const lower = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  return TYPE_TO_EXT[lower] ?? "bin";
}

// ── File-ingest extensions ───────────────────────────────────────────────────
// Mirrors the image path above, but for the reference-only file kinds
// (video/audio/document). The worker feeds these to Gemini for understanding
// and never serves the bytes, so we only need a sensible on-disk extension.

const FILE_TYPE_TO_EXT: Record<string, string> = {
  // video
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  // audio
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  // document
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

export const ALLOWED_FILE_KINDS = ["video", "audio", "document"] as const;
export type FileKind = (typeof ALLOWED_FILE_KINDS)[number];

export function kindForMime(mime: string): FileKind | null {
  const lower = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (lower.startsWith("video/")) return "video";
  if (lower.startsWith("audio/")) return "audio";
  if (
    lower === "application/pdf" ||
    lower === "application/msword" ||
    lower ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "document";
  return null;
}

export function extensionForFileMime(contentType: string): string {
  const lower = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  return FILE_TYPE_TO_EXT[lower] ?? "bin";
}

export const fileMetadataSchema = z.object({
  kind: z.enum(ALLOWED_FILE_KINDS),
  notes: z.string().optional().default(""),
  projectId: z.string().optional().default(""),
  visibility: flexibleVisibility,
});

export type FileIngestMetadata = z.infer<typeof fileMetadataSchema>;
