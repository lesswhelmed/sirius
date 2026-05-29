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

export async function getCachedLibraryPage(
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
