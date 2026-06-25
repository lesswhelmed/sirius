// @repo/ingest-classify — the single, pure, host-agnostic classification module
// shared by the web composer and the mobile Capture tab.
//
// ⚠️ SCOPE: this package decides DISPLAY + PRE-SUBMIT VALIDATION ONLY. It is a
// UX affordance — it never decides the final post type. The worker
// (apps/worker/src/pipeline/gemini-runner.ts) re-detects platform/host
// independently at ingest time and FORCES the final PostType (FINDING / SIGHT /
// BLOG) server-side. The platform sub-label here ("Repository"/"Instagram"/…)
// is a cosmetic badge + a hint to the user, never trusted for routing.
//
// Pure TS only: no React, no DOM-only or Node-only APIs. File inputs come in as
// host-neutral FileDescriptors (web wraps a DOM File, mobile wraps an RN asset);
// the core only reads name/mimeType/size and carries an opaque `ref` through for
// the host to map item -> real bytes at submit time. Mirrors the pure-package
// pattern of @repo/embedding-scene and @repo/ingest-draft.
//
// classifyUrl() here is the migrated single source of truth that previously
// lived in apps/web/app/(app)/ingest/materials.ts (now a re-export shim).

export type {
  ClassifiedItem,
  ClassifyError,
  FileDescriptor,
  IngestKind,
  InlineError,
  PlatformLabel,
} from "./types";

export {
  ACCEPTED_MIME,
  canOverride,
  classifyFile,
  classifyInput,
  classifyText,
  classifyUrl,
  dedupKey,
  DUP_KEY,
  fileKind,
  isHttpUrl,
  MAX_AUDIO_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_URLS,
  MAX_VIDEO_BYTES,
  OVERRIDE_MATRIX,
  overrideKind,
  platformFor,
  validateItem,
} from "./classify";

export type {
  ClassifyInput,
  ClassifyTextResult,
  ParsedUrl,
} from "./classify";

export { isYouTubeUrl, parseYouTubeUrl } from "./youtube-url";
export type { YouTubeUrlParse } from "./youtube-url";
