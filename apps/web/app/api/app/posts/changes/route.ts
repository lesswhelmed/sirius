import { listPostsChangedSince } from "@repo/db";
import { getSessionOrNull } from "../../../../../lib/session";

// Delta feed for the mobile offline mirror. The client passes its watermark
// (`since` — the newest Post.updatedAt it has applied) and gets back every
// owner-scoped change after it, including tombstones as deletes. The SSE stream
// (../stream) is just a nudge to call this; this endpoint is the source of post
// data, so it must stay session-authed and owner-scoped.
//
// No route segment config exports: Next 16 Cache Components rejects `dynamic`
// (and `runtime`). The handler is already dynamic — it reads the session from
// request headers — so nothing is cached.
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

	const result = await listPostsChangedSince({
		ownerId: session.user.id,
		since,
		limit: Number.isFinite(limit) ? limit : undefined,
	});

	return Response.json(result);
}
