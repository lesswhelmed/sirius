import { deleteAspiration, getAspiration, updateAspiration } from "@repo/db";
import { aspirationUpdateSchema } from "../../../../../lib/projects/schema";
import { getSessionOrNull } from "../../../../../lib/session";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

async function authed(params: Promise<{ id: string }>) {
  const session = await getSessionOrNull();
  if (!session) {
    return { ok: false as const, response: jsonError(401, "unauthorized") };
  }
  const { id } = await params;
  return { ok: true as const, userId: session.user.id, id };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await authed(params);
  if (!r.ok) return r.response;
  const aspiration = await getAspiration(r.userId, r.id);
  if (!aspiration) return jsonError(404, "not-found");
  return Response.json({ aspiration });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await authed(params);
  if (!r.ok) return r.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = aspirationUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const aspiration = await updateAspiration(r.userId, r.id, {
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    ...(parsed.data.description !== undefined
      ? { description: parsed.data.description }
      : {}),
  });
  if (!aspiration) return jsonError(404, "not-found");
  return Response.json({ aspiration });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await authed(params);
  if (!r.ok) return r.response;
  const deleted = await deleteAspiration(r.userId, r.id);
  if (!deleted) return jsonError(404, "not-found");
  return Response.json({ deleted: true });
}
