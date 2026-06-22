// Streams a PRIVATE retained file (an original upload or a built archive zip)
// as a download. Unlike serve-media.ts (public, cacheable), these responses are
// owner-/token-gated by the caller and marked private+no-store. The path comes
// from the DB (not user input), but we still confine it to the configured root
// as defense in depth.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain" },
  });
}

export interface ServeOriginalOptions {
  // Directory the file must live under (resolveOriginalsDir / resolveArchivesDir).
  baseDir: string;
  // Absolute path of the file to stream (from the DB).
  absolutePath: string;
  // Filename offered to the browser via Content-Disposition.
  downloadName: string;
  contentType?: string;
  // "inline" lets a browser <audio>/<video> element (or expo-audio) play the
  // file in place; default "attachment" preserves the download behavior the
  // source-file and archive routes rely on.
  disposition?: "inline" | "attachment";
  // The request's Range header value, if any. When present and valid we answer
  // with 206 partial content so media elements can seek; iOS AVPlayer requires
  // this to play remote audio at all. Omit (or pass null) for a full download.
  rangeHeader?: string | null;
}

// A parsed single-range request: a concrete byte window, an unsatisfiable range
// (→ 416), or no Range header at all (→ full 200).
type ParsedRange = { start: number; end: number } | "invalid" | null;

// Parse a single `bytes=` range against the known file size. We only support one
// range (the common media-player case); anything malformed is treated as
// unsatisfiable rather than silently serving the whole file.
function parseRange(header: string | null | undefined, size: number): ParsedRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return "invalid";

  let start: number;
  let end: number;
  if (startStr === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(endStr);
    if (suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Number(endStr);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  if (start > end || start >= size) return "invalid";
  if (end >= size) end = size - 1;
  return { start, end };
}

export async function serveOriginal(
  opts: ServeOriginalOptions,
): Promise<Response> {
  const base = resolve(opts.baseDir);
  const target = resolve(opts.absolutePath);
  if (target !== base && !target.startsWith(base + sep)) {
    return notFound();
  }

  let size: number;
  try {
    const info = await stat(target);
    if (!info.isFile()) return notFound();
    size = info.size;
  } catch {
    // Missing file: covers pre-feature posts whose retainedFilePath is null/gone.
    return notFound();
  }

  const contentType = opts.contentType ?? "application/octet-stream";
  const disposition = opts.disposition ?? "attachment";
  // Encode the filename to keep the header valid for unicode names.
  const safeName = opts.downloadName.replace(/["\\\r\n]/g, "_");
  const dispositionHeader = `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`;

  const range = parseRange(opts.rangeHeader, size);
  if (range === "invalid") {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: {
        "content-range": `bytes */${size}`,
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
      },
    });
  }

  if (range) {
    const { start, end } = range;
    const partial = Readable.toWeb(
      createReadStream(target, { start, end }),
    ) as unknown as ReadableStream;
    return new Response(partial, {
      status: 206,
      headers: {
        "content-type": contentType,
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${size}`,
        "accept-ranges": "bytes",
        "content-disposition": dispositionHeader,
        "cache-control": "private, no-store",
      },
    });
  }

  const body = Readable.toWeb(
    createReadStream(target),
  ) as unknown as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(size),
      "accept-ranges": "bytes",
      "content-disposition": dispositionHeader,
      "cache-control": "private, no-store",
    },
  });
}
