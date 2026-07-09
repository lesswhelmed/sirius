import { listReflectionChangedSince } from "@repo/db";
import { getSessionOrNull } from "../../../../../lib/session";

// Owner-global reflection delta feed for the mobile offline mirror — the
// reflection analogue of /api/app/comments/changes. The client passes its
// watermark (`since` = the newest prompt/response updatedAt it has applied) and
// gets back every reflection prompt AND response on any of the owner's posts
// changed after it, tombstones included as deletes, on ONE cursor. The SSE
// stream (../posts/stream) nudges the client to call this.
//
// No route segment config exports: Next 16 Cache Components rejects `dynamic`.
// The handler is already dynamic — it reads the session from request headers.
export async function GET(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get("since");
  const limitParam = url.searchParams.get("limit");

  // Invalid/absent `since` ⇒ full backfill from epoch.
  const parsedSince = sinceParam ? new Date(sinceParam) : null;
  const since =
    parsedSince && !Number.isNaN(parsedSince.getTime())
      ? parsedSince
      : new Date(0);

  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const result = await listReflectionChangedSince({
    ownerId: session.user.id,
    since,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  return Response.json(result);
}
