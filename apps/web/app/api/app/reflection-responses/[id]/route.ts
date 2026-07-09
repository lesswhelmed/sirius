import {
  notifyReflectionChanged,
  prisma,
  tombstoneReflectionResponse,
  upsertReflectionResponse,
} from "@repo/db";
import { scanReflectionBodyOrDeny } from "../../../../../lib/reflections/safety";
import { reflectionResponseUpdateSchema } from "../../../../../lib/reflections/schema";
import { agreedOr403, getSessionOrNull } from "../../../../../lib/session";

// Edit / retract a reflection answer, addressed by response id. AUTHOR-ONLY
// (the author is the post owner by construction): a non-author — or a probe at
// a nonexistent/tombstoned id — gets 404 so response ids can't be enumerated.
// Deletes are soft (tombstone) so the change rides the delta feed to mobile
// mirrors, mirroring the comments delete route. Audio files stay on disk on
// delete: tombstones can revive (re-answering the prompt), disk GC is out of
// scope.
//
// No route segment config exports: Next 16 Cache Components rejects `dynamic`.
// Both handlers are already dynamic (they read the session from headers).
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

// Load the response + the bits of its post the handlers need. Tombstoned rows
// read as gone (a revive goes through POST …/reflections, which re-upserts by
// promptId).
async function findLiveResponse(id: string) {
  return prisma.reflectionResponse.findUnique({
    where: { id },
    select: {
      id: true,
      promptId: true,
      postId: true,
      authorId: true,
      audioPath: true,
      status: true,
      post: { select: { slug: true, submittedById: true } },
    },
  });
}

// PATCH { body }: rewrite the answer text. Re-runs the SAME fail-closed safety
// gate as create (flagged → 422, scanner down → 503) before persisting. The
// existing audio pointer is preserved — editing the transcript never detaches
// the recording.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const denied = agreedOr403(session);
  if (denied) {
    return denied;
  }
  const { id } = await params;
  const existing = await findLiveResponse(id);
  if (
    !existing ||
    existing.status !== "active" ||
    existing.authorId !== session.user.id
  ) {
    return jsonError(404, "not-found");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = reflectionResponseUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }

  const deniedBySafety = await scanReflectionBodyOrDeny({
    body: parsed.data.body,
    userId: session.user.id,
    surface: `PATCH /api/app/reflection-responses/${id}`,
  });
  if (deniedBySafety) {
    return deniedBySafety;
  }

  // Reuse the upsert helper (keyed by promptId — this row) so the prompt↔post
  // linkage stays verified; audioPath is threaded through unchanged.
  const updated = await upsertReflectionResponse({
    promptId: existing.promptId,
    postId: existing.postId,
    authorId: session.user.id,
    body: parsed.data.body,
    audioPath: existing.audioPath,
  });
  if (!updated) {
    // Prompt tombstoned since the answer was written — treat as gone.
    return jsonError(404, "not-found");
  }

  // Best-effort realtime nudge to the POST OWNER's devices (owner-scoped feed).
  if (existing.post.submittedById) {
    void notifyReflectionChanged({
      op: "upsert",
      postId: existing.postId,
      ownerId: existing.post.submittedById,
      updatedAt: updated.updatedAt.toISOString(),
    }).catch(() => {});
  }

  return Response.json({
    response: {
      id: updated.id,
      body: updated.body,
      hasAudio: updated.audioPath != null,
      audioUrl:
        updated.audioPath != null
          ? `/api/app/posts/${existing.post.slug}/reflections/audio/${existing.promptId}`
          : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

// DELETE: soft-delete (tombstone) the answer. The prompt reverts to
// "unanswered" for the owner; the tombstone rides the delta feed as a delete.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { id } = await params;
  const existing = await findLiveResponse(id);
  if (!existing || existing.authorId !== session.user.id) {
    return jsonError(404, "not-found");
  }

  // Author-only enforced again inside the helper's where-guard; a raced or
  // already-tombstoned row matches zero and reads as gone.
  const ok = await tombstoneReflectionResponse(id, session.user.id);
  if (!ok) {
    return jsonError(404, "not-found");
  }

  if (existing.post.submittedById) {
    void notifyReflectionChanged({
      op: "delete",
      postId: existing.postId,
      ownerId: existing.post.submittedById,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  return Response.json({ ok: true });
}
