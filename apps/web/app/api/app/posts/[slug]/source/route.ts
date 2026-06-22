// Owner-only download of a post's retained source originals. Privacy is the
// priority: originals are NEVER served publicly — only the user who submitted
// the post may fetch them, gated on session + ownership.
//
//   GET .../source                  → single file: stream it; batch: JSON index
//   GET .../source?submissionId=ID   → stream that specific original
import {
  findPostAttributionBySlug,
  listRetainedSourcesForPost,
} from "@repo/db";
import { safeFilename } from "../../../../../../lib/export/markdown";
import { resolveOriginalsDir } from "../../../../../../lib/originals/originals-paths";
import { serveOriginal } from "../../../../../../lib/originals/serve-original";
import { getSessionOrNull } from "../../../../../../lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  if (post.submittedById !== session.user.id) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const sources = await listRetainedSourcesForPost(post.id);
  if (sources.length === 0) {
    return Response.json({ error: "no-source-files" }, { status: 404 });
  }

  const baseDir = resolveOriginalsDir();
  const url = new URL(request.url);
  const wanted = url.searchParams.get("submissionId");
  // ?disposition=inline streams for in-place playback (the original-content
  // audio player); the default download behavior is otherwise unchanged.
  const inline = url.searchParams.get("disposition") === "inline";
  const rangeHeader = request.headers.get("range");

  const stream = (sub: (typeof sources)[number]) =>
    serveOriginal({
      baseDir,
      absolutePath: sub.retainedFilePath as string,
      downloadName: `${safeFilename(slug)}-${sub.originalFilename ?? "original"}`,
      contentType: sub.originalMimeType ?? undefined,
      disposition: inline ? "inline" : "attachment",
      rangeHeader,
    });

  if (wanted) {
    const sub = sources.find((s) => s.id === wanted);
    if (!sub) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    return stream(sub);
  }

  // Single-file post: stream it directly. Batch (SIGHT): return a file index so
  // the UI can render one download link per image.
  if (sources.length === 1) {
    return stream(sources[0]!);
  }
  return Response.json({
    files: sources.map((s) => ({
      submissionId: s.id,
      originalFilename: s.originalFilename,
      mimeType: s.originalMimeType,
      sizeBytes: s.originalSizeBytes,
      href: `/api/app/posts/${slug}/source?submissionId=${s.id}`,
    })),
  });
}
