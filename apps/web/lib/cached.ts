// Cached read wrappers for shared, non-personalized data. Each uses the
// `use cache` directive with a lifetime and tags so the worker (or any
// mutation) can invalidate them via revalidateTag. These functions must never
// touch cookies/headers/searchParams — callers pass plain args, which become
// the cache key.

import {
	findPostBySlug,
	listCatalogPosts,
	listUserStorefront,
	type PostWithRelations,
	type StorefrontResult,
} from "@repo/db";
import { cacheLife, cacheTag } from "next/cache";

export async function getCachedPost(
	slug: string,
): Promise<PostWithRelations | null> {
	"use cache";
	// Shared, slug-keyed cache. Freshness is event-driven (worker writes + post
	// delete revalidate `post-${slug}` with expire:0), so this TTL is only a
	// backstop. Kept to "minutes" — not "hours" — so any future visibility window
	// (if canReadPost is widened or a publish/unpublish toggle is ever added and
	// a revalidate is missed) stays small. Per-request access is still gated by
	// canReadPost / the PUBLISHED check at every call site.
	cacheLife("minutes");
	cacheTag(`post-${slug}`);
	return findPostBySlug(slug);
}

// NOTE: the signed-in owner's private catalog is intentionally NOT cached here.
// It is personalized, session-scoped data (drafts + archived included) and must
// never share a cross-request cache, or one account could see another's posts
// after re-login. owner-catalog.tsx reads it directly via listPostsPage().

export async function getCachedCatalog(
	q: string | undefined,
	limit: number,
): Promise<Awaited<ReturnType<typeof listCatalogPosts>>> {
	"use cache";
	cacheLife("minutes");
	cacheTag("posts");
	return listCatalogPosts({ q, limit });
}

export async function getCachedStorefront(
	handle: string,
	limit: number,
): Promise<StorefrontResult> {
	"use cache";
	cacheLife("minutes");
	cacheTag("posts", `storefront-${handle}`);
	return listUserStorefront(handle, { limit });
}
