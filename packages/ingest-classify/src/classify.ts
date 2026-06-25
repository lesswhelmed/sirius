// Core classification logic. Pure functions — no DOM/RN/React. Implements the
// decision order, validation rules, override matrix, URL-splitting, and dedup
// from docs/superpowers/specs/2026-06-24-omni-ingest-design.md (§2), with the
// orchestrator-resolved open questions O-1..O-5 applied.

import { parseGitHubUrl } from "@repo/github-ingest";
import {
  type ClassifiedItem,
  type FileDescriptor,
  type IngestKind,
  type InlineError,
  type PlatformLabel,
} from "./types";
import { parseYouTubeUrl } from "./youtube-url";

// ── Constants ────────────────────────────────────────────────────────────────

// Cap on URL cards produced from one paste (mirrors the old
// materials.ts MAX_URLS_PER_BATCH = 200 and the server's fan-out tolerance).
export const MAX_URLS = 200;

// O-1 file-size advisory caps (WARN-only — never blocks submit). Bytes. The
// server enforces no explicit byte limit today; these are client-side UX
// guidance so the tray can warn early. Single source of truth for the UI copy.
const MB = 1024 * 1024;
export const MAX_IMAGE_BYTES = 50 * MB; // images
export const MAX_DOCUMENT_BYTES = 50 * MB; // PDF / Word docs
export const MAX_VIDEO_BYTES = 200 * MB; // reference-only video
export const MAX_AUDIO_BYTES = 200 * MB; // reference-only audio

// Per-kind cap lookup + a human-readable label for the warning copy.
export const MAX_FILE_BYTES: Record<
  "image" | "video" | "audio" | "document",
  number
> = {
  image: MAX_IMAGE_BYTES,
  document: MAX_DOCUMENT_BYTES,
  video: MAX_VIDEO_BYTES,
  audio: MAX_AUDIO_BYTES,
};

function humanCap(kind: "image" | "video" | "audio" | "document"): string {
  return `${Math.round(MAX_FILE_BYTES[kind] / MB)} MB`;
}

// Accepted MIME prefixes/exacts per kind, and the extension fallbacks used when
// the MIME is blank or application/octet-stream (common from the RN share sheet
// and some browser drops). Mirrors kindForMime + FILE_TYPE_TO_EXT/TYPE_TO_EXT in
// apps/web/lib/ingest/schema.ts.
export const ACCEPTED_MIME = {
  image: {
    prefixes: ["image/"],
    exts: ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"],
  },
  video: {
    prefixes: ["video/"],
    exts: ["mp4", "mov", "m4v"],
  },
  audio: {
    prefixes: ["audio/"],
    exts: ["mp3", "m4a", "wav", "aac"],
  },
  document: {
    prefixes: [] as string[],
    exacts: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    exts: ["pdf", "doc", "docx"],
  },
} as const;

// ── Display tags ─────────────────────────────────────────────────────────────

const DISPLAY_TAG: Record<IngestKind, string> = {
  url: "Link",
  note: "Note",
  image: "Photo",
  video: "Video",
  audio: "Audio",
  document: "Document",
};

// ── Override matrix (O-5) ────────────────────────────────────────────────────
// Rows = current kind; value = the set of target kinds the user may switch to
// (the card's own kind is always implicitly legal — see canOverride). Encodes
// the §2.8 table with O-5's same-endpoint restriction:
//   - text cards: url <-> note freely.
//   - file cards: video <-> audio <-> document interchange; image is ISOLATED
//     (image cannot become video/audio/document, nor can they become image).
//   - file -> url and file -> note are ALWAYS illegal (no text to put there).
export const OVERRIDE_MATRIX: Record<IngestKind, readonly IngestKind[]> = {
  url: ["note"],
  note: ["url"],
  // O-5: image is its own endpoint group (/api/app/ingest-images) — no cross.
  image: [],
  // video/audio/document share /api/app/ingest-file and may interchange.
  video: ["audio", "document"],
  audio: ["video", "document"],
  document: ["video", "audio"],
};

// ── id ───────────────────────────────────────────────────────────────────────

function newId(): string {
  // crypto.randomUUID is available on web, RN (Hermes 0.74+), and Bun/Node 19+.
  return globalThis.crypto.randomUUID();
}

// ── Item construction helpers ────────────────────────────────────────────────

function withErrors(item: ClassifiedItem): ClassifiedItem {
  const errors = validateItem(item);
  return { ...item, errors, error: errors[0] };
}

function makeUrlItem(rawUrl: string): ClassifiedItem {
  const platform = platformFor(rawUrl);
  return withErrors({
    id: newId(),
    kind: "url",
    platform,
    displayTag: DISPLAY_TAG.url,
    content: rawUrl,
    url: rawUrl,
    errors: [],
  });
}

function makeNoteItem(text: string): ClassifiedItem {
  return withErrors({
    id: newId(),
    kind: "note",
    displayTag: DISPLAY_TAG.note,
    content: text,
    text,
    errors: [],
  });
}

// ── URL matcher + platform sub-label (§2.4) ──────────────────────────────────

// A token is a URL iff WHATWG URL parses it AND the protocol is http(s).
export function isHttpUrl(token: string): boolean {
  try {
    const u = new URL(token.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Platform sub-label, in the §2.4 priority order. Cosmetic only — the worker
// re-detects host independently and is the sole routing authority.
export function platformFor(rawUrl: string): PlatformLabel {
  if (parseGitHubUrl(rawUrl)) return "repository";
  if (parseYouTubeUrl(rawUrl)) return "youtube";
  if (INSTAGRAM_URL_REGEX.test(rawUrl)) return "instagram";
  if (X_URL_REGEX.test(rawUrl)) return "x";
  return "link";
}

const INSTAGRAM_URL_REGEX =
  /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?/i;

const X_URL_REGEX =
  /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[^/]+\/status\/\d{15,20}/i;

// ── classifyUrl (MIGRATED from materials.ts — single source of truth) ────────
// Returns the legacy ParsedUrl shape so the materials.ts re-export shim keeps
// existing callers byte-compatible. The new code path should prefer
// platformFor()/isHttpUrl(); this stays for the migrated public surface.
export type ParsedUrl =
  | { kind: "instagram"; raw: string }
  | { kind: "x"; raw: string }
  | { kind: "other"; raw: string }
  | { kind: "invalid"; raw: string; reason: string };

export function classifyUrl(raw: string): ParsedUrl {
  if (INSTAGRAM_URL_REGEX.test(raw)) {
    return { kind: "instagram", raw };
  }
  if (X_URL_REGEX.test(raw)) {
    return { kind: "x", raw };
  }
  if (/^https?:\/\//i.test(raw)) {
    return { kind: "other", raw };
  }
  return { kind: "invalid", raw, reason: "not a URL" };
}

// ── File → kind (§2.2) ───────────────────────────────────────────────────────

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function mimeBase(mime: string): string {
  return mime.toLowerCase().split(";")[0]?.trim() ?? "";
}

// Returns the file kind for a descriptor, or null if unsupported.
export function fileKind(
  meta: Pick<FileDescriptor, "name" | "mimeType">,
): "image" | "video" | "audio" | "document" | null {
  const mime = mimeBase(meta.mimeType);
  const blankMime = mime === "" || mime === "application/octet-stream";

  if (!blankMime) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (ACCEPTED_MIME.document.exacts.includes(mime as never))
      return "document";
  }

  // MIME blank / octet-stream / unrecognized → extension fallback.
  const ext = extOf(meta.name);
  if (ACCEPTED_MIME.image.exts.includes(ext as never)) return "image";
  if (ACCEPTED_MIME.video.exts.includes(ext as never)) return "video";
  if (ACCEPTED_MIME.audio.exts.includes(ext as never)) return "audio";
  if (ACCEPTED_MIME.document.exts.includes(ext as never)) return "document";
  return null;
}

// classifyFile(meta) → one ClassifiedItem. Unsupported types produce an item in
// an error state (file_unsupported, critical), so the host still renders a card
// the user can delete.
export function classifyFile(meta: FileDescriptor): ClassifiedItem {
  const kind = fileKind(meta);
  if (kind === null) {
    const item: ClassifiedItem = {
      id: newId(),
      kind: "document", // placeholder bin; the error is what matters
      displayTag: DISPLAY_TAG.document,
      content: meta.name,
      file: meta,
      errors: [],
    };
    const errors: InlineError[] = [
      {
        field: "file",
        code: "file_unsupported",
        message:
          "We can't read this file type. Supported: images, video, audio, PDF, or Word docs.",
        severity: "critical",
      },
    ];
    return { ...item, errors, error: errors[0] };
  }
  return withErrors({
    id: newId(),
    kind,
    displayTag: DISPLAY_TAG[kind],
    content: meta.name,
    file: meta,
    errors: [],
  });
}

// ── classifyText (§2.3) ──────────────────────────────────────────────────────

export interface ClassifyTextResult {
  items: ClassifiedItem[];
  // Surfaced so the host can show "N duplicate links skipped" / "N over the
  // cap" affordances, parity with today's deduped/capped pills.
  deduped: number;
  capped: number;
}

// Tokenize on whitespace (incl. newlines) OR comma — a superset of the old
// urlMaterialsFromText delimiter. URL tokens become url cards; the remaining
// prose, reassembled in original order, becomes EXACTLY ONE note card.
export function classifyText(raw: string): ClassifyTextResult {
  const tokens = raw.split(/[\s,]+/).filter((t) => t.length > 0);
  const items: ClassifiedItem[] = [];
  const prose: string[] = [];
  const seen = new Set<string>();
  let deduped = 0;
  let capped = 0;
  let urlCount = 0;

  for (const token of tokens) {
    if (isHttpUrl(token)) {
      const key = dedupKeyForUrl(token);
      if (seen.has(key)) {
        deduped++;
        continue;
      }
      seen.add(key);
      if (urlCount >= MAX_URLS) {
        capped++;
        continue;
      }
      urlCount++;
      items.push(makeUrlItem(token));
    } else {
      // Bare domains (no scheme) fall here (O-3): they become prose/note.
      prose.push(token);
    }
  }

  const noteText = prose.join(" ").trim();
  if (noteText.length > 0) {
    items.push(makeNoteItem(noteText));
  }

  return { items, deduped, capped };
}

// ── classifyInput (top-level entry, §2.1) ────────────────────────────────────
// Host-agnostic single entry point. Pass a text string OR a file descriptor (or
// array) and get 1..N ClassifiedItems. When both files and text are present the
// host should decide (per §2.1 step 3); this helper handles one input source at
// a time — pass files and text separately if a gesture carries both.
export type ClassifyInput = string | FileDescriptor | FileDescriptor[];

export function classifyInput(input: ClassifyInput): ClassifiedItem[] {
  if (typeof input === "string") {
    return classifyText(input).items;
  }
  const descriptors = Array.isArray(input) ? input : [input];
  return descriptors.map(classifyFile);
}

// ── validateItem (§2.6) ──────────────────────────────────────────────────────

export function validateItem(item: ClassifiedItem): InlineError[] {
  const errors: InlineError[] = [];

  if (item.kind === "url") {
    const url = item.url ?? item.content;
    if (!isHttpUrl(url)) {
      errors.push({
        field: "url",
        code: "url_invalid",
        message:
          "This doesn't look like a valid web address. Add https:// or fix the link.",
        severity: "critical",
      });
    } else {
      try {
        const host = new URL(url.trim()).hostname.toLowerCase();
        const ipLike = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
        if (host === "" || host === "localhost" || ipLike) {
          errors.push({
            field: "url",
            code: "url_suspicious",
            message:
              "We can't always read links like this — submit anyway if you're sure.",
            severity: "warn",
          });
        }
      } catch {
        // isHttpUrl already passed, so this branch is unreachable; ignore.
      }
    }
    return errors;
  }

  if (item.kind === "note") {
    const text = (item.text ?? item.content ?? "").trim();
    if (text.length === 0) {
      errors.push({
        field: "note",
        code: "note_empty",
        message: "Write something first.",
        severity: "critical",
      });
    }
    return errors;
  }

  // File kinds: image / video / audio / document.
  const meta = item.file;
  if (!meta) {
    // A file card with no descriptor is unsupported by definition.
    errors.push({
      field: "file",
      code: "file_unsupported",
      message:
        "We can't read this file type. Supported: images, video, audio, PDF, or Word docs.",
      severity: "critical",
    });
    return errors;
  }
  // Re-check the kind matches an accepted type (catches a bad override).
  if (fileKind(meta) === null) {
    errors.push({
      field: "file",
      code: "file_unsupported",
      message:
        "We can't read this file type. Supported: images, video, audio, PDF, or Word docs.",
      severity: "critical",
    });
  }
  const cap = MAX_FILE_BYTES[item.kind as keyof typeof MAX_FILE_BYTES];
  if (typeof cap === "number" && meta.size > cap) {
    // O-1: over-cap is WARN-only (advisory) — does NOT block submit.
    errors.push({
      field: "file",
      code: "file_too_large",
      message: `This file is over the ${humanCap(
        item.kind as keyof typeof MAX_FILE_BYTES,
      )} limit. Try a smaller file.`,
      severity: "warn",
    });
  }
  return errors;
}

// ── overrideKind / canOverride (§2.8, O-5) ───────────────────────────────────

export function canOverride(from: IngestKind, to: IngestKind): boolean {
  if (from === to) return true; // self is always a no-op-legal target
  return OVERRIDE_MATRIX[from].includes(to);
}

// Apply a legal override, re-deriving displayTag/platform and re-validating.
// Throws on an illegal transition (callers should gate the menu with
// canOverride; this is the enforcement backstop).
export function overrideKind(
  item: ClassifiedItem,
  kind: IngestKind,
): ClassifiedItem {
  if (!canOverride(item.kind, kind)) {
    throw new Error(
      `Illegal kind override: ${item.kind} -> ${kind} (see OVERRIDE_MATRIX)`,
    );
  }
  if (item.kind === kind) return item;

  // text <-> text: url <-> note.
  if (kind === "url") {
    const url = item.text ?? item.content ?? "";
    return makeUrlItem(url);
  }
  if (kind === "note") {
    const text = item.url ?? item.content ?? "";
    return makeNoteItem(text);
  }

  // file <-> file: keep the same descriptor, re-bin the kind.
  const next: ClassifiedItem = {
    ...item,
    kind,
    platform: undefined,
    displayTag: DISPLAY_TAG[kind],
  };
  return withErrors({ ...next, errors: [] });
}

// ── dedupKey / DUP_KEY (§2.7) ────────────────────────────────────────────────

function dedupKeyForUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  // Prefer a canonical URL from the platform parsers when available.
  const gh = parseGitHubUrl(trimmed);
  if (gh) return gh.canonicalUrl.toLowerCase();
  const yt = parseYouTubeUrl(trimmed);
  if (yt) return yt.canonicalUrl.toLowerCase();
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/$/, "").replace(/\.git$/i, "");
    if (path === "") path = "/";
    // Preserve query (IG/YT IDs etc.).
    return `${host}${path}${u.search}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

// In-tray duplicate key (client pre-flight hint only; server dedup unchanged).
export function dedupKey(item: ClassifiedItem): string {
  switch (item.kind) {
    case "url":
      return `url:${dedupKeyForUrl(item.url ?? item.content)}`;
    case "note":
      return `note:${(item.text ?? item.content ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase()}`;
    default: {
      // file kinds: name + ":" + size.
      const f = item.file;
      return `file:${f?.name ?? item.content}:${f?.size ?? 0}`;
    }
  }
}

// Task-spec alias.
export const DUP_KEY = dedupKey;
