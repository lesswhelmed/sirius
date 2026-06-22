import { auth } from "@repo/auth";
import { headers } from "next/headers";
import { getSessionOrNull } from "../../../../../lib/session";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { id } = await params;

  // header-scoped → better-auth enforces that the key belongs to the caller;
  // a key id for another user surfaces as not-found rather than deleting it.
  try {
    await auth.api.deleteApiKey({
      body: { keyId: id },
      headers: await headers(),
    });
  } catch {
    return jsonError(404, "not-found");
  }
  return Response.json({ deleted: true });
}
