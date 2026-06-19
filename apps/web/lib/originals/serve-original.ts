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
  // Filename offered to the browser via Content-Disposition: attachment.
  downloadName: string;
  contentType?: string;
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

  const body = Readable.toWeb(
    createReadStream(target),
  ) as unknown as ReadableStream;

  // Encode the filename to keep the header valid for unicode names.
  const safeName = opts.downloadName.replace(/["\\\r\n]/g, "_");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": opts.contentType ?? "application/octet-stream",
      "content-length": String(size),
      "content-disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`,
      "cache-control": "private, no-store",
    },
  });
}
