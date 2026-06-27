// Decides WHICH submissions get scanned and builds the concrete scan targets
// (text + media parts) for the guardrail call. Scope (locked with the user):
// scan user-PRODUCED material — notes, images, documents, audio, video — and
// fetch-and-scan PDFs even when linked by URL. Third-party links (general
// articles, YouTube, Instagram/X, GitHub) are NOT scanned; the user is merely
// bookmarking them. Author notes attached to ANY submission ARE scanned as text.
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseGitHubUrl } from "@repo/github-ingest";
import { parseInstagramUrl } from "../../lib/instagram-url";
import { parseTwitterUrl } from "../../lib/twitter-url";
import { parseYouTubeUrl } from "../../lib/youtube-url";
import type { SafetyConfig } from "./config";
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

async function fetchPdf(
  url: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    // Confirm it's actually a PDF first (catches extension-less PDFs and avoids
    // downloading a huge non-PDF). A HEAD failure is non-fatal — fall back to
    // the .pdf-extension signal.
    let contentType = "";
    try {
      const head = await fetch(url, { method: "HEAD", signal: controller.signal });
      contentType = head.headers.get("content-type") ?? "";
      const len = Number(head.headers.get("content-length"));
      if (Number.isFinite(len) && len > maxBytes) return null;
    } catch {
      // ignore — decide on extension below
    }
    const looksPdf = /application\/pdf/i.test(contentType) || isLikelyPdfUrl(url);
    if (!looksPdf) return null;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
        const looksPdf = isLikelyPdfUrl(url);
        // HEAD-check non-.pdf URLs only when notes are absent isn't worth it;
        // fetchPdf already HEAD-checks content-type, so try any non-social URL
        // that either ends in .pdf or we can't otherwise classify cheaply.
        if (!looksPdf) continue;
        const pdf = await fetchPdf(url, cfg.maxPdfBytes);
        if (pdf) {
          targets.push({ kind: "file", data: pdf, mediaType: "application/pdf" });
        }
      }
      break;
    }
  }

  return targets;
}
