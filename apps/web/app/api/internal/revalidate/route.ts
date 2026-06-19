import { revalidateTag } from "next/cache";

// Internal endpoint the worker calls after writing a post, so cached post
// bodies and lists refresh immediately instead of waiting out cacheLife.
// Guarded by a shared secret in REVALIDATE_TOKEN (Bearer). If the env var is
// unset the endpoint is disabled (503) rather than open.
export async function POST(request: Request) {
	const token = process.env.REVALIDATE_TOKEN;
	if (!token) {
		return Response.json({ error: "revalidate-disabled" }, { status: 503 });
	}

	const auth = request.headers.get("authorization");
	if (auth !== `Bearer ${token}`) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}

	let body: { slug?: string; tags?: string[] } = {};
	try {
		body = await request.json();
	} catch {
		// empty/invalid body is fine — fall back to invalidating the list tag
	}

	const tags = new Set<string>(["posts"]);
	if (typeof body.slug === "string" && body.slug) {
		tags.add(`post-${body.slug}`);
	}
	if (Array.isArray(body.tags)) {
		for (const t of body.tags) {
			if (typeof t === "string" && t) tags.add(t);
		}
	}

	// expire: 0 purges matching entries immediately (on-demand invalidation).
	for (const tag of tags) {
		revalidateTag(tag, { expire: 0 });
	}

	return Response.json({ revalidated: [...tags] });
}
