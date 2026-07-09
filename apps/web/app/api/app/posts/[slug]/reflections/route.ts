import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  findPostAttributionBySlug,
  listReflectionForPost,
  notifyReflectionChanged,
  upsertReflectionResponse,
} from "@repo/db";
import { canReadPost } from "../../../../../../lib/post-access";
import {
  MAX_REFLECTION_AUDIO_BYTES,
  reflectionAudioExtForMime,
  resolveReflectionAudioAbsolute,
  saveReflectionAudio,
} from "../../../../../../lib/reflections/audio";
import { scanReflectionBodyOrDeny } from "../../../../../../lib/reflections/safety";
import {
  reflectionResponseCreateSchema,
} from "../../../../../../lib/reflections/schema";
import { toReflectionItemWire } from "../../../../../../lib/reflections/wire";
import { agreedOr403, getSessionOrNull } from "../../../../../../lib/session";

// The reflection thread on a post: AI-generated prompts + the OWNER's answers.
//
// Visibility inherits the post exactly — reads gate through canReadPost (the
// single read policy), same as comments, so friends/group/public audiences see
// the Q&A read-only. Writes are OWNER-ONLY: reflections are the owner's own
// words on their own material, never a conversation surface (that's comments).
// Realtime nudges target the POST OWNER (the reflection delta feed is
// owner-scoped), mirroring the comments routes.
//
// No route segment config exports: Next 16 Cache Components rejects `dynamic`.
// Both handlers are already dynamic (they read the session from headers).
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

// GET: list the post's reflection thread (active prompts first, then
// superseded-but-answered history). audioPath is never exposed verbatim — the
// wire mapping swaps it for hasAudio + the gated streaming URL.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post || !(await canReadPost(post, session.user.id))) {
    return jsonError(404, "not-found");
  }
  const items = await listReflectionForPost(post.id);
  return Response.json({
    items: items.map((item) => toReflectionItemWire(item, slug)),
  });
}

// Multipart bodies carry the audio answer; anything meaningfully over the audio
// cap is rejected before buffering (Content-Length fast-path — App Router
// handlers impose NO default body limit, so an unbounded formData() read could
// OOM the fork-mode web process). 1MB of headroom covers fields + boundaries.
const MAX_MULTIPART_BYTES = MAX_REFLECTION_AUDIO_BYTES + 1024 * 1024;

// POST: write (or revive/overwrite) the owner's answer to a prompt.
//
//   JSON      → { promptId, body }                        (text answer)
//   multipart → fields promptId, body (the transcript), file field "audio"
//
// The answer text goes through the SAME fail-closed safety gate as the post
// publish/edit path BEFORE anything persists (flagged → 422, scanner down →
// 503). Audio is validated against a small container allowlist + 25MB cap and
// stored under the PRIVATE originals root keyed by promptId (1:1 with the
// response), then the row is upserted with the relative pointer.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const denied = agreedOr403(session);
  if (denied) {
    return denied;
  }
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post || !(await canReadPost(post, session.user.id))) {
    return jsonError(404, "not-found");
  }
  // Owner-only write: readers of the post may see the thread, never author it.
  if (post.submittedById !== session.user.id) {
    return jsonError(403, "forbidden");
  }

  const contentType = request.headers.get("content-type") ?? "";
  const isMultipart = contentType.includes("multipart/form-data");

  let promptId: string;
  let body: string;
  let audio: { bytes: Uint8Array; ext: string } | null = null;

  if (isMultipart) {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
      return jsonError(413, "audio-too-large");
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400, "invalid multipart body");
    }
    const parsed = reflectionResponseCreateSchema.safeParse({
      promptId: form.get("promptId"),
      body: form.get("body"),
    });
    if (!parsed.success) {
      return jsonError(400, "validation failed");
    }
    promptId = parsed.data.promptId;
    body = parsed.data.body;

    const file = form.get("audio");
    if (file != null) {
      if (!(file instanceof File)) {
        return jsonError(400, "validation failed");
      }
      const ext = reflectionAudioExtForMime(file.type);
      if (!ext) {
        return jsonError(415, "unsupported-audio-type");
      }
      if (file.size > MAX_REFLECTION_AUDIO_BYTES) {
        return jsonError(413, "audio-too-large");
      }
      audio = { bytes: new Uint8Array(await file.arrayBuffer()), ext };
    }
  } else {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError(400, "invalid JSON body");
    }
    const parsed = reflectionResponseCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "validation failed");
    }
    promptId = parsed.data.promptId;
    body = parsed.data.body;
  }

  // Safety gate BEFORE anything persists (fail-closed 422/503).
  const deniedBySafety = await scanReflectionBodyOrDeny({
    body,
    userId: session.user.id,
    surface: `POST /api/app/posts/${slug}/reflections`,
  });
  if (deniedBySafety) {
    return deniedBySafety;
  }

  // Persist the audio first (keyed by promptId — unique per response, known
  // before the row exists), then upsert the row with the relative pointer.
  let audioPath: string | null = null;
  if (audio) {
    try {
      audioPath = await saveReflectionAudio({
        userId: session.user.id,
        promptId,
        ext: audio.ext,
        bytes: audio.bytes,
      });
    } catch (err) {
      console.error(
        `[reflections.POST] audio save failed for ${slug}/${promptId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return jsonError(500, "audio-save-failed");
    }
  }

  const response = await upsertReflectionResponse({
    promptId,
    postId: post.id,
    authorId: session.user.id,
    body,
    audioPath,
  });
  if (!response) {
    // Invalid prompt (wrong post / tombstoned / unknown) — drop the just-saved
    // audio so a probing request can't park bytes under a bogus key.
    if (audioPath) {
      const resolved = resolveReflectionAudioAbsolute(audioPath);
      if (resolved) {
        void rm(dirname(resolved.absolutePath), {
          recursive: true,
          force: true,
        }).catch(() => {});
      }
    }
    return jsonError(400, "invalid-prompt");
  }

  // Best-effort realtime nudge to the owner's connected devices (SSE → delta
  // pull). A notify failure must not fail the write.
  if (post.submittedById) {
    void notifyReflectionChanged({
      op: "upsert",
      postId: post.id,
      ownerId: post.submittedById,
      updatedAt: response.updatedAt.toISOString(),
    }).catch(() => {});
  }

  // Return the full thread item (prompt + fresh answer) so the client can slot
  // it in place without refetching the whole thread.
  const items = await listReflectionForPost(post.id);
  const item = items.find((i) => i.id === promptId);
  return Response.json(
    { item: item ? toReflectionItemWire(item, slug) : null },
    { status: 201 },
  );
}
