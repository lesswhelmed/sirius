// Cached read wrappers for shared, non-personalized data. Each uses the
// `use cache` directive with a lifetime and tags so the worker (or any
// mutation) can invalidate them via revalidateTag. These functions must never
// touch cookies/headers/searchParams — callers pass plain args, which become
// the cache key.
import { cacheLife, cacheTag } from "next/cache";
import {
  findPostBySlug,
  listCatalogPosts,
  listPostsPage,
  listUserStorefront,
  type ListPostsPageOptions,
  type PageNumberResult,
  type Post,
  type PostWithRelations,
  type StorefrontResult,
} from "@repo/db";

export async function getCachedPost(
  slug: string
): Promise<PostWithRelations | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(`post-${slug}`);
  return findPostBySlug(slug);
}

// The signed-in owner catalog. `opts` (including submittedById) becomes the
// cache key, so each user's view is cached independently; the "posts" tag lets
// the worker invalidate every catalog when it writes a new post.
export async function getCachedOwnerCatalog(
  opts: ListPostsPageOptions
): Promise<PageNumberResult<Post>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("posts");
  return listPostsPage(opts);
}

export async function getCachedCatalog(
  q: string | undefined,
  limit: number
): Promise<Awaited<ReturnType<typeof listCatalogPosts>>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("posts");
  return listCatalogPosts({ q, limit });
}

export async function getCachedStorefront(
  handle: string,
  limit: number
): Promise<StorefrontResult> {
  "use cache";
  cacheLife("minutes");
  cacheTag("posts", `storefront-${handle}`);
  return listUserStorefront(handle, { limit });
}
