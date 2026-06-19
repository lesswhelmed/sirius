import { createAspiration, listAspirations } from "@repo/db";
import { aspirationCreateSchema } from "../../../../lib/projects/schema";
import { getSessionOrNull } from "../../../../lib/session";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function GET(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const page = await listAspirations(session.user.id, { cursor });
  return Response.json(page);
}

export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = aspirationCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const aspiration = await createAspiration({
    ownerId: session.user.id,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
  });
  return Response.json({ aspiration }, { status: 201 });
}
