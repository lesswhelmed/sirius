// Serves worker-written post media (image batches + downloaded social covers)
// straight from disk at request time.
//
// Why this exists: `next start` only serves files that were in `public/` at
// BUILD time. The ingest worker writes images at RUNTIME (after the build), so
// `public/sight/<batch>/N.jpg` and `public/social/ig-*.jpg` 404 through Next's
// static handler in production. These route handlers read the bytes from disk
// on every request, so runtime-written media is always served. In production
// Caddy also file_servers these paths directly (see infra/caddy/Caddyfile) —
// this is the in-app path that works in dev and as the resolution target for the
// next/image optimizer's in-process internal fetch.

import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join, resolve, sep } from "node:path";

// Resolve the media roots from the SAME env vars the worker writes to
// (apps/worker/src/pipeline/post-writer.ts), so reader and writer always agree.
// In production these are set to absolute paths in .env.production; in dev they
// are empty, and the web app's cwd is apps/web (PM2 + `next dev`), so the
// default resolves to the exact dir the worker's own default targets.
export function resolveSightDir(): string {
  const override = process.env.SIGHT_IMAGE_DIR?.trim();
  return override || join(process.cwd(), "public", "sight");
}

export function resolveSocialDir(): string {
  const override = process.env.SOCIAL_IMAGE_DIR?.trim();
  return override || join(process.cwd(), "public", "social");
}

// The worker transcodes HEIC at ingest, so served files are already browser
// formats; this map just labels the response. Unknown extensions fall through
// to octet-stream rather than guessing.
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

function contentTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain" },
  });
}

// Streams a media file under `baseDir` addressed by URL path `segments`. Confines
// reads to `baseDir` (path-traversal guard) and 404s on anything missing or
// outside the root. `segments` come from a Next catch-all param (already decoded).
export async function serveMedia(
  baseDir: string,
  segments: string[]
): Promise<Response> {
  if (
    segments.length === 0 ||
    segments.some((s) => !s || s === "." || s === ".." || s.includes("\0"))
  ) {
    return notFound();
  }

  const base = resolve(baseDir);
  const target = resolve(join(base, ...segments));
  if (target !== base && !target.startsWith(base + sep)) {
    return notFound();
  }

  let size: number;
  try {
    const info = await stat(target);
    if (!info.isFile()) return notFound();
    size = info.size;
  } catch {
    return notFound();
  }

  const filename = segments[segments.length - 1]!;
  // Web ReadableStream from the Node read stream so we don't buffer whole files
  // (a single sight original can be >10 MB) into memory per request.
  const body = Readable.toWeb(
    createReadStream(target)
  ) as unknown as ReadableStream;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentTypeFor(filename),
      "content-length": String(size),
      // Served media is effectively immutable per URL (unique batch ids /
      // stable social shortcodes), but allow a re-ingest to take over within a
      // week rather than pinning for a year.
      "cache-control": "public, max-age=604800",
    },
  });
}
