import { blockUser, prisma, unblockUser } from "@repo/db";
import { z } from "zod";
import {
  sendModerationAlert,
  type ModerationPostContext,
} from "../../../../../../lib/moderation/alert";
import { getSessionOrNull } from "../../../../../../lib/session";

// POST: block a user (App Store Guideline 1.2 Part C) — creates the directional
// UserBlock, severs the friendship + share-group memberships (one transaction in
// blockUser), and notifies the developer by email (Apple requires blocking to
// surface the inappropriate content to the developer). DELETE lifts the block.
//
// The dynamic segment is named [handle] because Next.js forbids two different
// slug names at the same path position and /api/app/users/[handle]/posts
// already owns this level — but the VALUE clients send here is the user ID
// (the feed exposes submittedBy.id). Resolution tries id first, then falls
// back to handle, so both /api/app/users/<id>/block and
// /api/app/users/<handle>/block work.
const blockSchema = z.object({
  // Context for the alert email: the post that prompted the block, if any.
  postSlug: z.string().trim().min(1).optional(),
});

const IDENTITY_SELECT = {
  id: true,
  name: true,
  handle: true,
  email: true,
} as const;

async function resolveUser(idOrHandle: string) {
  const byId = await prisma.user.findUnique({
    where: { id: idOrHandle },
    select: IDENTITY_SELECT,
  });
  if (byId) return byId;
  return prisma.user.findUnique({
    where: { handle: idOrHandle.toLowerCase() },
    select: IDENTITY_SELECT,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // The body is optional context — a bare POST (no/empty body) is valid.
  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    // No JSON body: treat as no context.
  }
  const parsed = blockSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return Response.json({ error: "validation failed" }, { status: 400 });
  }

  const { handle } = await params;
  const target = await resolveUser(handle);
  if (!target) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const result = await blockUser({
    blockerId: session.user.id,
    blockedId: target.id,
  });
  if (!result.ok) {
    return Response.json({ error: "cannot block yourself" }, { status: 400 });
  }

  // Best-effort alert email — never fail the block on a send error. Blocking
  // MUST still hold even when the notification path is down.
  try {
    let post: ModerationPostContext | null = null;
    if (parsed.data.postSlug) {
      const row = await prisma.post.findUnique({
        where: { slug: parsed.data.postSlug },
        select: {
          slug: true,
          title: true,
          submittedBy: { select: IDENTITY_SELECT },
        },
      });
      if (row) {
        post = { slug: row.slug, title: row.title, author: row.submittedBy };
      }
    }
    await sendModerationAlert({
      kind: "block",
      blocker: {
        id: session.user.id,
        name: session.user.name,
        handle: session.user.handle ?? null,
        email: session.user.email,
      },
      blocked: target,
      post,
    });
  } catch (err) {
    console.error(
      `[moderation] block alert email failed for ${target.id}:`,
      err,
    );
  }

  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { handle } = await params;
  const target = await resolveUser(handle);
  if (!target) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  // Idempotent: unblocking someone you never blocked still succeeds.
  await unblockUser({ blockerId: session.user.id, blockedId: target.id });
  return Response.json({ ok: true });
}
