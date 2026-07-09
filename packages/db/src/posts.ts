// Read queries for the Post table. Writes are owned by the worker
// (post-writer.ts) — keep this file query-only.
import {
  PostStatus,
  PostType,
  PostVisibility,
  type Prisma,
} from "../generated/prisma";
import { type Category, type Post, prisma, type Tag } from "./index";
import type { PageResult } from "./ingest";
import { blockedAuthorExclusion, isBlockedEither } from "./moderation";
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
  ownAudience?: OwnAudience | null;
};

export type OwnAudienceGroup = { id: string; name: string };
export type OwnAudience = {
  // The viewer's own sharing choice for this post. Only FRIENDS | GROUP | PUBLIC
  // ever appear (PRIVATE posts are not in the feed and get no badge).
  visibility: PostVisibility;
  // Non-empty IFF visibility === "GROUP". Each entry is one ShareGroup the post
  // is shared to. Owner-only — never populated for another author's post.
  groups: OwnAudienceGroup[];
};

export interface PostFilters {
  type?: PostType | PostType[];
  status?: PostStatus | PostStatus[];
  published?: boolean;
  q?: string;
  submittedById?: string;
  // Filter to posts carrying this tag (matched by Tag.slug). Combines with the
  // other (non-tag) filters as AND. Kept for callers/links that pass a single
  // tag; folds into `tags` below.
  tag?: string;
  // Multi-tag widen (matched by Tag.slug), OR / union semantics — a post matches
  // if it carries ANY listed tag (a single `{ tags: { some: { slug: { in } } } }`
  // clause). The catalog tag strip is multi-select and additive, so this is the
  // primary tag filter; `tag` is merged in.
  tags?: string[];
  // Filter to the single primary category (matched by Category.slug). A post has
  // exactly one category in the shipped data model, so this is an equality narrow.
  category?: string;
  // Narrow to one (or several) visibility tiers. The public catalog/storefront
  // composition helpers set this to PUBLIC so a PUBLISHED-but-PRIVATE/FRIENDS/GROUP
  // post can never leak through a public list — the surface-level kill-switch
  // (PUBLIC_CATALOG_ENABLED) gates WHETHER the list renders, this gates WHICH posts
  // are eligible. Owner-scoped lists omit it (the owner sees all their own tiers).
  visibility?: PostVisibility | PostVisibility[];
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
    const q = opts.q.trim();
    // Search across the fields a browsing owner would expect: the title, the
    // excerpt, and tag names. OR-combined so any single match surfaces the row.
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { excerpt: { contains: q, mode: "insensitive" } },
      { tags: { some: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }
  if (opts.submittedById) {
    where.submittedById = opts.submittedById;
  }
  // Multi-tag widen with OR / union semantics: a post matches if it carries ANY
  // selected tag, so a single `{ tags: { some: { slug: { in } } } }` clause does
  // it (one clause per tag would be AND — match ALL). The legacy single `tag` is
  // folded into the same set so both entry points share one code path.
  const tagSlugs = [...(opts.tags ?? []), ...(opts.tag ? [opts.tag] : [])]
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const uniqueTagSlugs = [...new Set(tagSlugs)];
  if (uniqueTagSlugs.length > 0) {
    where.tags = { some: { slug: { in: uniqueTagSlugs } } };
  }
  if (opts.category && opts.category.trim().length > 0) {
    where.categories = { some: { slug: opts.category.trim() } };
  }
  if (opts.visibility) {
    where.visibility = Array.isArray(opts.visibility)
      ? { in: opts.visibility }
      : opts.visibility;
  }
  return where;
}

export interface ListPostsOptions extends PostFilters {
  limit?: number;
  cursor?: string;
  includeSubmitter?: boolean;
}

export async function listPosts(
  opts: ListPostsOptions = {},
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

// Owner-scoped cursor list for the signed-in cockpit. `ownerId` is required and
// always overrides any caller-supplied owner, so the session-authed `/api/app/
// posts` route cannot return another user's posts. `listPosts` stays the
// low-level builder for the public catalog/storefront composition helpers, which
// set their own explicit (intentionally public) filters.
export function listOwnerPosts(
  ownerId: string,
  opts: Omit<ListPostsOptions, "submittedById"> = {},
): Promise<PageResult<Post>> {
  return listPosts({ ...opts, submittedById: ownerId });
}

// ---------------------------------------------------------------------------
// Friends feed: posts a signed-in viewer may BROWSE that aren't (only) their own.
//
// This is a distinct query from listOwnerPosts (which is owner-forced and must
// never widen). The visibility predicate is fundamentally an OR across
// ownership/sharing tiers, composed via AND with the normal filters so q/type/
// tag still apply. friendIds come from friendIdsOf() (friends.ts), looked up
// once per request by the caller.
// ---------------------------------------------------------------------------

// "posts I SHARED (FRIENDS/GROUP/PUBLIC — never my own PRIVATE), OR a friend's
// FRIENDS post, OR a friend's GROUP post I'm a member of, OR PUBLIC (when enabled)".
// When `friendsOnly` is true the viewer's own-posts clause is DROPPED so the
// feed shows only OTHERS' shared posts. Edge case: friendsOnly with no friends
// and no public access must match ZERO rows — an empty `OR: []` is permissive
// in Prisma (it's effectively `false` but we don't rely on that), so we emit an
// explicit never-matching predicate instead.
export function visibilityWhereForViewer(
  viewerId: string,
  friendIds: string[],
  includePublic: boolean,
  friendsOnly = false,
  // Authors to exclude entirely (UserBlock, both directions — from
  // moderation.blockedIdsFor). Threaded like friendIds; defaults empty so
  // existing callers are unchanged.
  blockedIds: string[] = [],
): Prisma.PostWhereInput {
  const or: Prisma.PostWhereInput[] = friendsOnly
    ? []
    : [
        {
          submittedById: viewerId,
          // Own posts in the feed are SHARED only — the owner's PRIVATE cockpit
          // posts live solely in the catalog and must never surface here (this is
          // "everything beyond the owner cockpit"). FRIENDS/GROUP/PUBLIC all count
          // as shared regardless of who can ultimately read them.
          visibility: {
            in: [
              PostVisibility.FRIENDS,
              PostVisibility.GROUP,
              PostVisibility.PUBLIC,
            ],
          },
        },
      ];
  if (friendIds.length > 0) {
    or.push({
      visibility: PostVisibility.FRIENDS,
      submittedById: { in: friendIds },
    });
    // GROUP tier: a friend's GROUP post the viewer is a current member of. The
    // `submittedById in friendIds` clause is defense-in-depth (still a friend);
    // membership is checked via the PostShareGroup → ShareGroupMember relation.
    or.push({
      visibility: PostVisibility.GROUP,
      submittedById: { in: friendIds },
      shareGroups: {
        some: { group: { members: { some: { userId: viewerId } } } },
      },
    });
  }
  if (includePublic) {
    or.push({ visibility: PostVisibility.PUBLIC });
  }
  // No clauses (friendsOnly, no friends, no public) → match nothing explicitly.
  const base: Prisma.PostWhereInput =
    or.length === 0 ? { OR: [{ id: { equals: "__none__" } }] } : { OR: or };
  // Block exclusion clamps the WHOLE predicate (every OR tier — a blocked
  // author's PUBLIC post is just as gone as their FRIENDS post).
  if (blockedIds.length === 0) {
    return base;
  }
  return { AND: [base, blockedAuthorExclusion(blockedIds)] };
}

export interface ListVisibleOptions extends PostFilters {
  viewerId: string;
  friendIds: string[];
  includePublic: boolean;
  // Blocked-author exclusion (moderation.blockedIdsFor — both directions).
  // Optional so existing callers are unchanged; the feed routes MUST pass it.
  blockedIds?: string[];
  // When true, exclude the viewer's OWN posts (show only friends'/public posts).
  // Defaults to false → identical to the historical owner-inclusive feed.
  friendsOnly?: boolean;
  limit?: number;
  cursor?: string;
}

// A cursor feed of everything a signed-in viewer is allowed to browse beyond the
// owner cockpit. AND-clamped to PUBLISHED so a friend never sees drafts/archived
// even if a draft was mis-marked FRIENDS. Always includes the submitter so the
// card can show whose post it is.
export async function listVisibleToViewer(
  opts: ListVisibleOptions,
): Promise<PageResult<PostWithSubmitter>> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const where: Prisma.PostWhereInput = {
    AND: [
      buildPostWhere(opts),
      visibilityWhereForViewer(
        opts.viewerId,
        opts.friendIds,
        opts.includePublic,
        opts.friendsOnly ?? false,
        opts.blockedIds ?? [],
      ),
      { status: PostStatus.PUBLISHED },
    ],
  };
  const items = await prisma.post.findMany({
    where,
    take: take + 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      submittedBy: {
        select: { id: true, name: true, handle: true, image: true },
      },
      shareGroups: {
        select: { group: { select: { id: true, name: true } } },
      },
    },
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  // Enrich the viewer's OWN non-PRIVATE rows with their audience summary, and
  // strip the raw shareGroups relation from EVERY row so a peer's group name
  // never crosses the wire.
  const enriched = trimmed.map((row) => {
    const { shareGroups, ...rest } = row as typeof row & {
      shareGroups: { group: { id: string; name: string } }[];
    };
    const isOwn = rest.submittedById === opts.viewerId;
    const ownAudience: OwnAudience | null =
      isOwn && rest.visibility !== PostVisibility.PRIVATE
        ? {
            visibility: rest.visibility,
            groups:
              rest.visibility === PostVisibility.GROUP
                ? shareGroups.map((sg) => ({
                    id: sg.group.id,
                    name: sg.group.name,
                  }))
                : [],
          }
        : null;
    return { ...rest, ownAudience } as PostWithSubmitter;
  });
  const last = enriched[enriched.length - 1];
  return {
    items: enriched,
    nextCursor: hasMore && last ? last.id : null,
  };
}

// ---------------------------------------------------------------------------
// One friend's catalog: a cursor feed of a SINGLE author's PUBLISHED posts that
// a friend may browse (visibility FRIENDS or PUBLIC; PRIVATE never appears).
// Mirrors listVisibleToViewer's shape but is scoped to one author and NEVER
// includes the viewer's own posts.
//
// SCOPING ONLY — this query does NOT verify that the caller is actually friends
// with `friendId`. The route (GET /api/app/friends/[handle]/posts) must run
// areFriends() FIRST and 404 if not. Calling this for a non-friend would still
// only ever return that author's FRIENDS/PUBLIC published posts, but the
// friendship gate is the route's job, not the query's.
// ---------------------------------------------------------------------------
export interface ListFriendCatalogOptions extends PostFilters {
  friendId: string;
  // The session viewer. When present, a UserBlock in either direction between
  // viewer and author short-circuits to an empty page — defense-in-depth on
  // top of the route's areFriends() gate (blockUser deletes the friendship,
  // but a block must hold even if that cascade is ever bypassed).
  viewerId?: string;
  limit?: number;
  cursor?: string;
}

export async function listFriendCatalog(
  opts: ListFriendCatalogOptions,
): Promise<PageResult<PostWithSubmitter>> {
  if (opts.viewerId && (await isBlockedEither(opts.viewerId, opts.friendId))) {
    return { items: [], nextCursor: null };
  }
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const where: Prisma.PostWhereInput = {
    AND: [
      buildPostWhere(opts),
      { submittedById: opts.friendId },
      {
        visibility: {
          in: [PostVisibility.FRIENDS, PostVisibility.PUBLIC],
        },
      },
      { status: PostStatus.PUBLISHED },
    ],
  };
  const items = await prisma.post.findMany({
    where,
    take: take + 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      submittedBy: {
        select: { id: true, name: true, handle: true, image: true },
      },
    },
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  const last = trimmed[trimmed.length - 1];
  return {
    items: trimmed as PostWithSubmitter[],
    nextCursor: hasMore && last ? last.id : null,
  };
}

// Numbered (offset) pagination for the catalog ledger. Distinct from the
// cursor-based listPosts so each contract stays unambiguous.
export type PostSort = "newest" | "oldest" | "title";

// Each sort carries an id tiebreaker so offset paging is deterministic (no row
// can straddle a page boundary when two rows share a sort key).
const POST_ORDER_BY: Record<PostSort, Prisma.PostOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }, { id: "desc" }],
  oldest: [{ createdAt: "asc" }, { id: "asc" }],
  title: [{ title: "asc" }, { id: "asc" }],
};

export interface ListPostsPageOptions extends PostFilters {
  page?: number; // 1-based; clamped to >= 1
  pageSize?: number; // default 50, max 200
  sort?: PostSort; // default "newest"
  includeSubmitter?: boolean;
  // Include the post's tags + single category so the catalog card can render its
  // taxonomy footer (category pill + tag chips) without an N+1 follow-up query.
  includeTaxonomy?: boolean;
  // Attach the owner's audience (visibility + group names) to each row. Only
  // meaningful when the page is scoped to the owner's own posts (submittedById).
  includeOwnAudience?: boolean;
}

export type PageNumberResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

// A list row that may carry its relations depending on the include flags. The
// relation fields are optional so a `Post`-typed consumer still accepts it.
export type PostListItem = Post & {
  submittedBy?: SubmitterSummary | null;
  tags?: Tag[];
  categories?: Category[];
  ownAudience?: OwnAudience | null;
};

export async function listPostsPage(
  opts: ListPostsPageOptions = {},
): Promise<PageNumberResult<PostListItem>> {
  const pageSize = Math.min(
    MAX_PAGE,
    Math.max(1, opts.pageSize ?? DEFAULT_PAGE),
  );
  const requestedPage = Math.max(1, Math.floor(opts.page ?? 1));
  const where = buildPostWhere(opts);

  // Count first so we can clamp the page before computing the offset —
  // otherwise an out-of-range page would skip past all rows and return empty.
  const total = await prisma.post.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const orderBy = POST_ORDER_BY[opts.sort ?? "newest"];

  const include: Prisma.PostInclude = {};
  if (opts.includeSubmitter) {
    include.submittedBy = {
      select: { id: true, name: true, handle: true, image: true },
    };
  }
  if (opts.includeTaxonomy) {
    include.tags = true;
    include.categories = true;
  }
  if (opts.includeOwnAudience) {
    include.shareGroups = {
      select: { group: { select: { id: true, name: true } } },
    };
  }
  const hasInclude = Object.keys(include).length > 0;

  const items = await prisma.post.findMany({
    where,
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
    ...(hasInclude ? { include } : {}),
  });

  // Catalog rows are always the owner's own posts, so each non-PRIVATE row may
  // carry an ownAudience. Strip the raw shareGroups relation when present.
  const mapped = items.map((row) => {
    if (!opts.includeOwnAudience) return row as PostListItem;
    const { shareGroups, ...rest } = row as typeof row & {
      shareGroups: { group: { id: string; name: string } }[];
    };
    const ownAudience: OwnAudience | null =
      rest.visibility !== PostVisibility.PRIVATE
        ? {
            visibility: rest.visibility,
            groups:
              rest.visibility === PostVisibility.GROUP
                ? shareGroups.map((sg) => ({
                    id: sg.group.id,
                    name: sg.group.name,
                  }))
                : [],
          }
        : null;
    return { ...rest, ownAudience } as PostListItem;
  });
  return { items: mapped, page, pageSize, total, totalPages };
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

// id + owner + the fields canReadPost needs, for routes that gate behavior on
// authorship/visibility (analytics view-exclusion, comments read/write,
// visibility mutation). Returns visibility + status so the caller can run the
// shared read policy without a second query.
export async function findPostAttributionBySlug(slug: string): Promise<{
  id: string;
  submittedById: string | null;
  visibility: PostVisibility;
  status: PostStatus;
} | null> {
  return prisma.post.findUnique({
    where: { slug },
    select: { id: true, submittedById: true, visibility: true, status: true },
  });
}

// Idempotency probe for the ingest worker: has a post already been written for
// this submission's stable source record id? Lets a reclaimed/retried job skip
// re-running the pipeline instead of duplicating the post.
export async function findPostBySourceRecordId(
  sourceRecordId: string,
): Promise<{ id: string; slug: string } | null> {
  return prisma.post.findFirst({
    where: { sourceRecordId },
    select: { id: true, slug: true },
  });
}

export type PostWithRelations = Post & {
  tags: Tag[];
  categories: Category[];
  submittedBy: SubmitterSummary | null;
};

export function findPostBySlug(
  slug: string,
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

// Batch-fetch the owner's posts by slug, with tags + categories, to enrich
// search/browse results that start from a lightweight id list (e.g. the
// embedding scene's post nodes). Owner-scoped via submittedById, so a slug that
// isn't the owner's is silently dropped — there is no cross-user leak even if a
// caller passes a foreign slug. Order is NOT preserved; callers that rank
// (e.g. semantic search) keep their own order and look rows up by slug.
export function listPostsBySlugs(
  ownerId: string,
  slugs: string[],
): Promise<(Post & { tags: Tag[]; categories: Category[] })[]> {
  if (slugs.length === 0) {
    return Promise.resolve([]);
  }
  return prisma.post.findMany({
    where: { submittedById: ownerId, slug: { in: slugs } },
    include: { tags: true, categories: true },
  });
}

// Like listPostsBySlugs but gated by an arbitrary visibility predicate (built by
// searchVisibilityWhere in search.ts) instead of owner-only — curated search
// spans the viewer's OWN posts AND friends'/public ones, so owner-scoping would
// wrongly drop reachable hits. Defense in depth: a slug the viewer can't actually
// read is silently dropped here even if it leaked into the ranked set. Order is
// NOT preserved; the caller re-orders by its fused rank and looks rows up by slug.
export function listPostsBySlugsVisible(
  slugs: string[],
  visibilityWhere: Prisma.PostWhereInput,
): Promise<PostWithRelations[]> {
  if (slugs.length === 0) {
    return Promise.resolve([]);
  }
  return prisma.post.findMany({
    where: { AND: [{ slug: { in: slugs } }, visibilityWhere] },
    include: {
      tags: true,
      categories: true,
      submittedBy: {
        select: { id: true, name: true, handle: true, image: true },
      },
    },
  }) as Promise<PostWithRelations[]>;
}

// ---------------------------------------------------------------------------
// Delta feed for the mobile offline mirror.
//
// The mobile app keeps a local SQLite copy of the owner's posts and syncs
// incrementally: it asks for everything that changed since the last watermark
// (a Post.updatedAt timestamp). Tombstoned rows (syncStatus === "tombstone")
// come back as deletes. Tags/categories are flattened to NAME arrays since the
// mobile mirror stores them denormalized. Scoped to one owner — each device only
// ever pulls its own posts.
// ---------------------------------------------------------------------------
export type PostDelta = {
  id: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string | null;
  type: PostType;
  status: PostStatus;
  // The owner's own visibility setting, mirrored so the device can render the
  // visibility badge on their own posts offline. Friends' posts are never
  // mirrored (online-only), so this always reflects the owner's choice.
  visibility: PostVisibility;
  imageUrl: string | null;
  images: Prisma.JsonValue | null;
  tags: string[];
  categories: string[];
  sourceRecordId: string | null;
  // The id(s) of the IngestSubmission(s) that produced this post (the worker's
  // `resultPostId` back-relation). This is the STABLE reconcile key the device
  // matches its optimistic row's `submissionId` against — decoupled from
  // `sourceRecordId`, which a provider path (Twitter → tweetId, Instagram →
  // shortcode) overrides to its native id and so cannot be relied on for the
  // optimistic-row match. Empty for posts created without an ingest submission.
  sourceSubmissionIds: string[];
  // Provider provenance + its structured digest, so the device can render the
  // repo chip (and any future provider badge) without re-fetching the source.
  providerId: string;
  contentDigest: Prisma.JsonValue | null;
  // "full" | "stub" — whether the body got the AI pass. Drives the degraded-
  // bookmark badge + "Regenerate with AI" CTA on owner surfaces.
  aiTreatment: string;
  // Server-computed (gemini-embedding-2) retrieval vector, mirrored down so the
  // device can run "ask my posts" semantic search WITHOUT embedding documents
  // on-device. Null until the worker has embedded the post. `embeddingModel` +
  // `embeddingDim` identify the vector space (must match the query-embed
  // endpoint's modelId) so the device only ranks a query against same-space docs.
  embedding: number[] | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PostChange =
  | { op: "upsert"; post: PostDelta }
  | { op: "delete"; id: string; deletedAt: string };

export type PostChangesResult = {
  changes: PostChange[];
  // ISO of the newest updatedAt in this page; the client's next `since`. Null
  // only when the page was empty (client keeps its existing watermark).
  nextCursor: string | null;
  hasMore: boolean;
};

export async function listPostsChangedSince(opts: {
  ownerId: string;
  since: Date;
  limit?: number;
}): Promise<PostChangesResult> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? MAX_PAGE));
  // Strict `gt` + (updatedAt, id) ordering. Two posts sharing an exact
  // millisecond updatedAt across a page boundary is vanishingly unlikely at this
  // write volume; reconciliation is an idempotent upsert-by-id so a duplicate
  // delivery is harmless even if it happened.
  const rows = await prisma.post.findMany({
    where: {
      submittedById: opts.ownerId,
      updatedAt: { gt: opts.since },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: take + 1,
    include: {
      tags: { select: { name: true } },
      categories: { select: { name: true } },
      embedding: {
        select: { embedding: true, modelVersion: true, dimensionality: true },
      },
      // The originating submission(s) — the device reconciles its optimistic row
      // by matching its stored `submissionId` against one of these ids (see
      // PostDelta.sourceSubmissionIds).
      sourceSubmissions: { select: { id: true } },
    },
  });
  const hasMore = rows.length > take;
  const trimmed = hasMore ? rows.slice(0, take) : rows;
  const changes: PostChange[] = trimmed.map((p) =>
    p.syncStatus === "tombstone"
      ? { op: "delete", id: p.id, deletedAt: p.updatedAt.toISOString() }
      : {
          op: "upsert",
          post: {
            id: p.id,
            slug: p.slug,
            title: p.title,
            content: p.content,
            excerpt: p.excerpt,
            type: p.type,
            status: p.status,
            visibility: p.visibility,
            imageUrl: p.imageUrl,
            images: p.images,
            tags: p.tags.map((t) => t.name),
            categories: p.categories.map((c) => c.name),
            sourceRecordId: p.sourceRecordId,
            sourceSubmissionIds: p.sourceSubmissions.map((s) => s.id),
            providerId: p.providerId,
            contentDigest: p.contentDigest,
            aiTreatment: p.aiTreatment,
            embedding: p.embedding?.embedding ?? null,
            embeddingModel: p.embedding?.modelVersion ?? null,
            embeddingDim: p.embedding?.dimensionality ?? null,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          },
        },
  );
  const last = trimmed[trimmed.length - 1];
  return {
    changes,
    nextCursor: last ? last.updatedAt.toISOString() : null,
    hasMore,
  };
}

// Public catalog: Instagram-sourced (SOCIAL) posts that have been published.
export interface CatalogFilters {
  q?: string;
  limit?: number;
  cursor?: string;
}

export function listCatalogPosts(
  opts: CatalogFilters = {},
): Promise<PageResult<Post>> {
  return listPosts({
    type: PostType.SOCIAL,
    status: PostStatus.PUBLISHED,
    // Only PUBLIC posts are eligible for the public catalog — a PUBLISHED post at
    // any other tier (PRIVATE is the default) must never appear here regardless of
    // PUBLIC_CATALOG_ENABLED. Mirrors canReadPost's PUBLIC tier.
    visibility: PostVisibility.PUBLIC,
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
  opts: { limit?: number; cursor?: string } = {},
): Promise<StorefrontResult> {
  const user = await findUserByHandle(handle);
  if (!user) {
    return null;
  }
  const posts = await listPosts({
    submittedById: user.id,
    status: PostStatus.PUBLISHED,
    // A public storefront shows only the owner's PUBLIC posts — never their
    // PRIVATE/FRIENDS/GROUP rows. Mirrors canReadPost's PUBLIC tier.
    visibility: PostVisibility.PUBLIC,
    includeSubmitter: false,
    limit: opts.limit,
    cursor: opts.cursor,
  });
  return { user, posts };
}
