import { findPostAttributionBySlug, prisma } from "@repo/db";
import { canReadPost } from "../../../../../../../../lib/post-access";
import { serveOriginal } from "../../../../../../../../lib/originals/serve-original";
import {
  reflectionAudioContentType,
  resolveReflectionAudioAbsolute,
} from "../../../../../../../../lib/reflections/audio";
import { getSessionOrNull } from "../../../../../../../../lib/session";

// Streams a reflection answer's audio recording. Gated by canReadPost — the
// post's whole AUDIENCE may play it (friends/group/public tiers included), not
// just the owner, exactly matching who sees the thread itself. The viewer may
// be anonymous: canReadPost(post, null) admits only the PUBLIC tier when the
// catalog flags allow it, mirroring the public listing page that renders the
// Q&A. Every deny is 404 so slugs/prompt ids can't be probed.
//
// Range-enabled (206) via serveOriginal — iOS AVPlayer and browser <audio>
// seeking require it. The file lives under the PRIVATE originals root
// (audioPath is a relative pointer); resolution is traversal-guarded twice
// (resolveReflectionAudioAbsolute + serveOriginal's baseDir confinement).
//
// No route segment config exports: Next 16 Cache Components rejects `dynamic`.
// The handler is already dynamic (it reads the session from headers).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; promptId: string }> },
) {
  const session = await getSessionOrNull();
  const viewerId = session?.user.id ?? null;
  const { slug, promptId } = await params;

  const post = await findPostAttributionBySlug(slug);
  if (!post || !(await canReadPost(post, viewerId))) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const response = await prisma.reflectionResponse.findUnique({
    where: { promptId },
    select: { postId: true, status: true, audioPath: true },
  });
  if (
    !response ||
    response.postId !== post.id || // prompt must belong to THIS post
    response.status !== "active" ||
    response.audioPath == null
  ) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const resolved = resolveReflectionAudioAbsolute(response.audioPath);
  if (!resolved) {
    // Corrupt/tampered pointer that escapes the originals root.
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const ext = response.audioPath.split(".").pop() ?? "m4a";
  return serveOriginal({
    baseDir: resolved.baseDir,
    absolutePath: resolved.absolutePath,
    downloadName: `reflection-${promptId}.${ext}`,
    contentType: reflectionAudioContentType(response.audioPath),
    disposition: "inline",
    rangeHeader: request.headers.get("range"),
  });
}
