// Best-effort page-title fetch for saved-link stub cards. Fired-and-forgotten
// from materials.ts right after the optimistic raw-URL card is created: on
// success the card's "Link from {host}" title upgrades to the real page title
// (via updateLocalStubTitle); on ANY failure — offline, timeout, non-HTML,
// parse miss — it resolves null and the stub title simply stands. Capture must
// stay instant, so this is never awaited on the submit path, keeps a tight
// 2.5s budget, and reads at most the first 64 KiB of the page (titles live in
// <head>). Never throws.
import { fetch as expoFetch } from "expo/fetch";

const FETCH_TIMEOUT_MS = 2500;
// Titles live in <head>; stop reading (and abort the transfer) past this.
const MAX_READ_BYTES = 64 * 1024;
// When the body can't be streamed we must buffer the whole response — skip
// anything the server declares larger than this rather than buffering it.
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

// The handful of named entities that actually show up in real-world <title>
// text; numeric/hex references are decoded generically below.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  middot: "·",
  copy: "©",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, code: string) => {
      if (code.startsWith("#")) {
        const hex = code[1] === "x" || code[1] === "X";
        const cp = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
          ? String.fromCodePoint(cp)
          : match;
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    },
  );
}

// og:title is preferred over <title> — sites load site-name/SEO cruft into
// <title> but keep og:title as the clean human name of the page.
function extractOgTitle(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/(?:property|name)\s*=\s*["']og:title["']/i.test(tag)) continue;
    // Capture per-delimiter: a shared [^"'] class would truncate a
    // double-quoted title at its first apostrophe ("Don't…" → "Don").
    const content = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const value = content?.[1] ?? content?.[2];
    if (value) return value;
  }
  return null;
}

function extractTitleTag(html: string): string | null {
  return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null;
}

// Decode entities, collapse whitespace, and cap to ~80 chars — the same
// ellipsis logic as deriveNoteTitle (sync/writes.ts) so all derived card
// titles truncate identically.
function cleanTitle(raw: string): string | null {
  const collapsed = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > 80
    ? `${collapsed.slice(0, 79).trimEnd()}…`
    : collapsed;
}

// Read up to MAX_READ_BYTES of the body, then abort the transfer — enough to
// cover any sane <head>. Falls back to buffering the whole response (bounded
// by the declared content-length) when the body isn't streamable.
async function readHtmlPrefix(
  resp: Awaited<ReturnType<typeof expoFetch>>,
  controller: AbortController,
): Promise<string | null> {
  const body = resp.body;
  if (!body) {
    const declared = Number(resp.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BUFFERED_BYTES) {
      controller.abort(); // don't leave the oversized transfer running
      return null;
    }
    return await resp.text();
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let html = "";
  let bytes = 0;
  while (bytes < MAX_READ_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
  }
  if (bytes >= MAX_READ_BYTES) controller.abort();
  return html + decoder.decode();
}

/**
 * Fetch the human title of an http(s) page: og:title first, then <title>.
 * Resolves null on any failure — bad scheme, timeout (2.5s), non-2xx,
 * non-HTML content type, oversized unstreamable body, or no title found.
 * Never throws and never rejects.
 */
export async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await expoFetch(url, {
        signal: controller.signal,
        headers: { accept: "text/html" },
      });
      // Abort before every give-up return: expo/fetch keeps the native
      // transfer downloading (and buffering) until it's cancelled, so bailing
      // on e.g. a direct MP4/PDF link without aborting would leave the full
      // body streaming in the background after we've already resolved null.
      if (!resp.ok) {
        controller.abort();
        return null;
      }
      const contentType = resp.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/html")) {
        controller.abort();
        return null;
      }
      const html = await readHtmlPrefix(resp, controller);
      if (!html) return null;
      const raw = extractOgTitle(html) ?? extractTitleTag(html);
      return raw ? cleanTitle(raw) : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
