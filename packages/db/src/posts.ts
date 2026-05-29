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
import { findUserByHandle } from "./users";

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

export type SubmitterSummary = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
};

export type PostWithSubmitter = Post & {
  submittedBy: SubmitterSummary | null;
};

export interface PostFilters {
  type?: PostType | PostType[];
  status?: PostStatus | PostStatus[];
  published?: boolean;
  q?: string;
  submittedById?: string;
}

// Shared filter semantics for listPosts / listPostsPage / countPosts so the
// page query and its count never drift apart.
function buildPostWhere(opts: PostFilters): Prisma.PostWhereInput {
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
  if (opts.submittedById) {
    where.submittedById = opts.submittedById;
  }
  return where;
}

export interface ListPostsOptions extends PostFilters {
  limit?: number;
  cursor?: string;
  includeSubmitter?: boolean;
}

export async function listPosts(
  opts: ListPostsOptions = {}
): Promise<PageResult<Post>> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const where = buildPostWhere(opts);
  const items = await prisma.post.findMany({
    where,
    take: take + 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(opts.includeSubmitter
      ? {
          include: {
            submittedBy: {
              select: { id: true, name: true, handle: true, image: true },
            },
          },
        }
      : {}),
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

// Numbered (offset) pagination for the Library ledger. Distinct from the
// cursor-based listPosts so each contract stays unambiguous.
export interface ListPostsPageOptions extends PostFilters {
  page?: number; // 1-based; clamped to >= 1
  pageSize?: number; // default 50, max 200
  includeSubmitter?: boolean;
}

export type PageNumberResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export async function listPostsPage(
  opts: ListPostsPageOptions = {}
): Promise<PageNumberResult<Post>> {
  const pageSize = Math.min(MAX_PAGE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE));
  const requestedPage = Math.max(1, Math.floor(opts.page ?? 1));
  const where = buildPostWhere(opts);

  // Count first so we can clamp the page before computing the offset —
  // otherwise an out-of-range page would skip past all rows and return empty.
  const total = await prisma.post.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);

  const items = await prisma.post.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    ...(opts.includeSubmitter
      ? {
          include: {
            submittedBy: {
              select: { id: true, name: true, handle: true, image: true },
            },
          },
        }
      : {}),
  });

  return { items, page, pageSize, total, totalPages };
}

export function countPosts(filters: PostFilters = {}): Promise<number> {
  return prisma.post.count({ where: buildPostWhere(filters) });
}

// Lightweight slug -> id resolution for mutation routes that only need the id.
export async function findPostIdBySlug(slug: string): Promise<string | null> {
  const row = await prisma.post.findUnique({
    where: { slug },
    select: { id: true },
  });
  return row?.id ?? null;
}

// id + owner, for routes that gate behavior on authorship (e.g. excluding the
// owner's own views from analytics).
export async function findPostAttributionBySlug(
  slug: string
): Promise<{ id: string; submittedById: string | null } | null> {
  return prisma.post.findUnique({
    where: { slug },
    select: { id: true, submittedById: true },
  });
}

export type PostWithRelations = Post & {
  tags: Tag[];
  categories: Category[];
  submittedBy: SubmitterSummary | null;
};

export function findPostBySlug(
  slug: string
): Promise<PostWithRelations | null> {
  return prisma.post.findUnique({
    where: { slug },
    include: {
      tags: true,
      categories: true,
      submittedBy: {
        select: { id: true, name: true, handle: true, image: true },
      },
    },
  });
}

// Public catalog: Instagram-sourced (SOCIAL) posts that have been published.
export interface CatalogFilters {
  q?: string;
  limit?: number;
  cursor?: string;
}

export function listCatalogPosts(
  opts: CatalogFilters = {}
): Promise<PageResult<Post>> {
  return listPosts({
    type: PostType.SOCIAL,
    status: PostStatus.PUBLISHED,
    includeSubmitter: true,
    q: opts.q,
    limit: opts.limit,
    cursor: opts.cursor,
  });
}

export type StorefrontResult = {
  user: {
    id: string;
    name: string;
    handle: string;
    bio: string | null;
    location: string | null;
    image: string | null;
  };
  posts: PageResult<Post>;
} | null;

export async function listUserStorefront(
  handle: string,
  opts: { limit?: number; cursor?: string } = {}
): Promise<StorefrontResult> {
  const user = await findUserByHandle(handle);
  if (!user) {
    return null;
  }
  const posts = await listPosts({
    submittedById: user.id,
    status: PostStatus.PUBLISHED,
    includeSubmitter: false,
    limit: opts.limit,
    cursor: opts.cursor,
  });
  return { user, posts };
}
