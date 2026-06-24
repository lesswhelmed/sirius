import { dismissSubmission } from "@repo/db";
import { getSessionOrNull } from "../../../../../lib/session";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const count = await dismissSubmission(session.user.id, id);
  if (count === 0) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
