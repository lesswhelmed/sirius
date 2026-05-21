import { setUserHandle } from "@repo/db";
import { z } from "zod";

import { getSessionOrNull } from "../../../../../lib/session";

const handleSchema = z.object({
  handle: z.string().trim().min(3).max(30),
});

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
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

  const parsed = handleSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }

  const result = await setUserHandle(session.user.id, parsed.data.handle);
  if (!result.ok) {
    const status = result.reason === "taken" ? 409 : 400;
    return jsonError(
      status,
      result.reason === "taken" ? "handle is taken" : "handle is invalid",
    );
  }

  return Response.json({ handle: result.handle });
}
