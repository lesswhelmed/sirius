import { USER_NAME_MAX_CHARS, setUserName } from "@repo/db";
import { z } from "zod";

import { getSessionOrNull } from "../../../../../lib/session";

const nameSchema = z.object({
  name: z.string().trim().min(1).max(USER_NAME_MAX_CHARS),
});

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request): Promise<Response> {
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

  const parsed = nameSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }

  const result = await setUserName(session.user.id, parsed.data.name);
  if (!result.ok) {
    return jsonError(400, "name is invalid");
  }
  return Response.json({ name: result.name });
}
