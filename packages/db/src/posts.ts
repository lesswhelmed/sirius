// Read queries for the Post table. Writes are owned by the worker
// (post-writer.ts) — keep this file query-only.
import { Prisma, PostStatus, PostType } from "../generated/prisma";
import {
  prisma,
  type Category,
  type Post,
  type Tag,
} from "./index";
import type { PageResult } from "./ingest";

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

export interface ListPostsOptions {
  type?: PostType | PostType[];
  status?: PostStatus | PostStatus[];
  published?: boolean;
  q?: string;
  limit?: number;
  cursor?: string;
}

export async function listPosts(
  opts: ListPostsOptions = {}
): Promise<PageResult<Post>> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const where: Prisma.PostWhereInput = {};
  if (opts.type) {
    where.type = Array.isArray(opts.type) ? { in: opts.type } : opts.type;
  }
  if (opts.status) {
    where.status = Array.isArray(opts.status)
      ? { in: opts.status }
      : opts.status;
  }
  if (typeof opts.published === "boolean") {
    where.published = opts.published;
  }
  if (opts.q && opts.q.trim().length > 0) {
    where.title = { contains: opts.q.trim(), mode: "insensitive" };
  }
  const items = await prisma.post.findMany({
    where,
    take: take + 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  const last = trimmed[trimmed.length - 1];
  return {
    items: trimmed,
    nextCursor: hasMore && last ? last.id : null,
  };
}

export type PostWithRelations = Post & {
  tags: Tag[];
  categories: Category[];
};

export function findPostBySlug(
  slug: string
): Promise<PostWithRelations | null> {
  return prisma.post.findUnique({
    where: { slug },
    include: { tags: true, categories: true },
  });
}
