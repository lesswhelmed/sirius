// Decides WHICH submissions get scanned and builds the concrete scan targets
// (text + media parts) for the guardrail call. Scope (locked with the user):
// scan user-PRODUCED material — notes, images, documents, audio, video — and
// fetch-and-scan PDFs even when linked by URL. Third-party links (general
// articles, YouTube, Instagram/X, GitHub) are NOT scanned; the user is merely
// bookmarking them. Author notes attached to ANY submission ARE scanned as text.
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseGitHubUrl } from "@repo/github-ingest";
import {
  DraftEnvelopeSchema,
  SightDraftEnvelopeSchema,
} from "@repo/ingest-draft";
import { parseInstagramUrl } from "../../lib/instagram-url";
import { parseTwitterUrl } from "../../lib/twitter-url";
import { parseYouTubeUrl } from "../../lib/youtube-url";
import type { SafetyConfig } from "./config";
import { fetchGuardedPdf } from "./safe-fetch";
import type { PipelineInput, StagedImage } from "../types";

export type ScanTarget =
  | { kind: "text"; label: string; text: string }
  | { kind: "image"; data: Buffer; mediaType: string }
  | { kind: "file"; data: Buffer; mediaType: string };

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
};

function imageMime(staged: StagedImage): string {
  const ext = (staged.extension || extname(staged.stagedFilePath).slice(1)).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] ?? "image/jpeg";
}

// A URL whose path ends in .pdf (ignoring query/hash). The cheap synchronous
// signal used by shouldScan; collectScanTargets additionally HEAD-checks the
// content-type to catch extension-less PDFs.
export function isLikelyPdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /\.pdf$/i.test(u.pathname);
  } catch {
    return /\.pdf(\?|#|$)/i.test(url);
  }
}

// Third-party content handled by a dedicated runner and never scanned here.
function isThirdPartyLink(url: string): boolean {
  return Boolean(
    parseYouTubeUrl(url) ||
      parseInstagramUrl(url) ||
      parseTwitterUrl(url) ||
      parseGitHubUrl(url),
  );
}

// Cheap, synchronous, side-effect-free pre-gate — unit-tested in targets.test.ts.
// True ⇒ the worker runs collectScanTargets (which may still yield nothing, e.g.
// a url whose HEAD turns out non-PDF, in which case the gate allows).
export function shouldScan(input: PipelineInput): boolean {
  // A client-supplied draft is published VERBATIM (tryClientDraft skips Gemini),
  // so it must ALWAYS be scanned — including the single non-PDF URL path that is
  // otherwise out of scope. Without this a benign-notes + harmful-draft
  // submission would skip the gate entirely.
  if ("draft" in input && input.draft != null) return true;

  switch (input.kind) {
    case "note":
    case "image":
    case "document":
    case "audio":
    case "video":
      return true;
    case "url":
      return (
        input.notes.trim().length > 0 ||
        input.urls.some((u) => !isThirdPartyLink(u) && isLikelyPdfUrl(u))
      );
  }
}

// A valid client draft (on-device LLM) is honored by tryClientDraft and
// post-writer emits its title/body/excerpt/image-alts VERBATIM, skipping Gemini.
// That user-visible text is user-PRODUCED material and must be scanned as text —
// otherwise an attacker pairs benign notes with a harmful draft body. Parsed
// with the SAME schema tryClientDraft uses, so we scan exactly what would be
// published; an invalid draft yields no targets here but is also ignored there
// (falls back to the Gemini path), so nothing unscanned can slip through.
function collectDraftTargets(input: PipelineInput): ScanTarget[] {
  if (!("draft" in input) || input.draft == null) return [];

  const targets: ScanTarget[] = [];
  const push = (label: string, text: string | undefined) => {
    const trimmed = text?.trim();
    if (trimmed) targets.push({ kind: "text", label, text: trimmed });
  };

  if (input.kind === "image") {
    const parsed = SightDraftEnvelopeSchema.safeParse(input.draft);
    if (!parsed.success) return [];
    const { post } = parsed.data;
    push("draft title", post.title);
    push("draft body", post.body);
    push("draft excerpt", post.excerpt);
    for (const alt of post.imageAlts) push("draft image alt", alt);
    return targets;
  }

  // note + url both carry a PostDraftSchema envelope (DraftEnvelopeSchema).
  const parsed = DraftEnvelopeSchema.safeParse(input.draft);
  if (!parsed.success) return [];
  const { post } = parsed.data;
  push("draft title", post.title);
  push("draft body", post.body);
  return targets;
}

// Builds the actual parts handed to the guardrail. Async because the url path
// may HEAD + download PDFs. Returns [] when there is nothing user-produced to
// judge (e.g. a YouTube link with no notes) — the caller then allows.
export async function collectScanTargets(
  input: PipelineInput,
  cfg: SafetyConfig,
): Promise<ScanTarget[]> {
  const targets: ScanTarget[] = [];

  // Notes ride on every kind; always scan them as text.
  const notes = input.notes?.trim() ?? "";
  if (notes) targets.push({ kind: "text", label: "author notes", text: notes });

  // A client-supplied draft is published verbatim (skips Gemini) — scan its text.
  targets.push(...collectDraftTargets(input));

  switch (input.kind) {
    case "note":
      // notes already pushed above; nothing else.
      break;
    case "image":
      for (const staged of input.images) {
        if (!existsSync(staged.stagedFilePath)) continue;
        targets.push({
          kind: "image",
          data: readFileSync(staged.stagedFilePath),
          mediaType: imageMime(staged),
        });
      }
      break;
    case "document":
    case "audio":
    case "video":
      if (existsSync(input.stagedFilePath)) {
        targets.push({
          kind: "file",
          data: readFileSync(input.stagedFilePath),
          mediaType: input.mimeType,
        });
      }
      break;
    case "url": {
      // Only fetch+scan PDFs; third-party links (social/youtube/github) are
      // skipped entirely (their notes, if any, were already added above).
      for (const url of input.urls) {
        if (isThirdPartyLink(url)) continue;
        if (!isLikelyPdfUrl(url)) continue;
        // SSRF-hardened: validates scheme, blocks private/reserved IPs, pins the
        // resolved IP (no DNS rebinding), refuses redirects, caps the streamed body.
        const pdf = await fetchGuardedPdf(url, cfg.maxPdfBytes);
        if (pdf) {
          targets.push({ kind: "file", data: pdf, mediaType: "application/pdf" });
        }
      }
      break;
    }
  }

  return targets;
}
