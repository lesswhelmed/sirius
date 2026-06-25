// Curated corpus search: composes Postgres full-text (tsvector + ts_rank) and
// brute-force embedding cosine over the viewer-visible candidate set, then fuses
// both ranked lists via Reciprocal Rank Fusion. The single source of truth shared
// by /api/app/search (web + mobile) and the MCP keyword/semantic tools — UI and
// MCP can never drift because there is one searchCorpus().
//
// v1 embedding leg is brute-force in-memory cosine (fine for a viewer's reachable
// corpus — hundreds to low-thousands of vectors). Upgrade path, no signature
// change: pgvector vector(768) + HNSW + SQL `<=>` behind listVisiblePostEmbeddings.
import { PostStatus, PostVisibility, Prisma } from "../generated/prisma";
import { cosineSimilarity, embedContent, queryPrefix } from "./embed-client";
import { listVisiblePostEmbeddings } from "./embeddings";
import { friendIdsOf } from "./friends";
import { prisma } from "./index";
import { listPostsBySlugsVisible, type SubmitterSummary } from "./posts";

export type MatchReason = "exact" | "similar";

export interface SearchHit {
  slug: string;
  title: string;
  excerpt: string | null;
  type: string;
  status: string;
  categories: { slug: string; name: string }[];
  tags: { slug: string; name: string }[];
  submittedBy: SubmitterSummary | null;
  createdAt: string;
  score: number;
  snippet: string;
  matchReasons: MatchReason[];
}

export interface SearchPage {
  items: SearchHit[];
  nextCursor: string | null;
  // True when the embedding leg failed (Gemini down / no key) and results are
  // full-text only — the UI shows a subtle "similar matches unavailable" note.
  partial: boolean;
}

// RRF constant: dampens the contribution of lower-ranked items. 60 is the
// canonical default from the original RRF paper.
const RRF_K = 60;
// How many candidates each leg contributes to the fusion before paging.
const FUSION_CANDIDATES = 50;
const SNIPPET_MAX = 280;

// The ONE visibility predicate, shared with listVisiblePostEmbeddings: own posts
// (any status) OR friends' FRIENDS (published) OR PUBLIC (published, if allowed).
export function searchVisibilityWhere(
  viewerId: string,
  friendIds: string[],
  includePublic: boolean,
): Prisma.PostWhereInput {
  const or: Prisma.PostWhereInput[] = [{ submittedById: viewerId }];
  if (friendIds.length > 0) {
    or.push({
      submittedById: { in: friendIds },
      visibility: PostVisibility.FRIENDS,
      status: PostStatus.PUBLISHED,
    });
  }
  if (includePublic) {
    or.push({ visibility: PostVisibility.PUBLIC, status: PostStatus.PUBLISHED });
  }
  return { OR: or };
}

// Full-text leg: rank by ts_rank over the generated tsvector, visibility-gated
// inline in raw SQL (the predicate mirrors searchVisibilityWhere). websearch_to_
// tsquery gives users quote/OR/- syntax for free and never throws on bad input.
// Empty friendIds → ANY('{}') matches nothing; includePublic toggles the PUBLIC
// clause via a composed SQL fragment.
async function fullTextLeg(
  viewerId: string,
  query: string,
  friendIds: string[],
  includePublic: boolean,
  limit: number,
): Promise<string[]> {
  const publicClause = includePublic
    ? Prisma.sql`OR (p."visibility" = 'PUBLIC' AND p."status" = 'PUBLISHED')`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<{ slug: string }[]>`
    SELECT p."slug" AS slug,
           ts_rank(p."searchVector", websearch_to_tsquery('english', ${query})) AS rank
    FROM "Post" p
    WHERE p."searchVector" @@ websearch_to_tsquery('english', ${query})
      AND (
        p."submittedById" = ${viewerId}
        OR (p."visibility" = 'FRIENDS' AND p."status" = 'PUBLISHED'
            AND p."submittedById" = ANY(${friendIds}))
        ${publicClause}
      )
    ORDER BY rank DESC, p."createdAt" DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.slug);
}

export type QueryEmbedder = (query: string) => Promise<number[]>;

// Default seam: embed the query in the worker's space (asymmetric query prefix).
const defaultQueryEmbedder: QueryEmbedder = (q) =>
  embedContent([{ text: queryPrefix(q) }]);

// Pure cosine ranking — extracted from semanticLeg so it can be unit-tested
// without a DB or a live embedder.
export function rankByCosine(
  queryVector: number[],
  candidates: { slug: string; embedding: number[] }[],
  limit: number,
): string[] {
  return candidates
    .map((c) => ({ slug: c.slug, score: cosineSimilarity(queryVector, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.slug);
}

// Embedding leg: embed the query in the worker's space, cosine over the visible
// candidate set, return slugs ranked by similarity. Returns null (not throw) when
// the embedding call fails so searchCorpus can degrade to full-text only.
async function semanticLeg(
  viewerId: string,
  query: string,
  friendIds: string[],
  includePublic: boolean,
  limit: number,
  embedder: QueryEmbedder,
): Promise<string[] | null> {
  let queryVector: number[];
  try {
    queryVector = await embedder(query);
  } catch {
    return null;
  }
  const candidates = await listVisiblePostEmbeddings(
    viewerId,
    friendIds,
    includePublic,
  );
  return rankByCosine(queryVector, candidates, limit);
}

// Reciprocal Rank Fusion: each list contributes 1/(k+rank); a slug present in
// both legs accumulates both contributions AND collects both reasons, so
// both-legs hits naturally rank above single-leg hits.
export function reciprocalRankFusion(
  fullText: string[],
  semantic: string[],
): { slug: string; score: number; matchReasons: MatchReason[] }[] {
  const acc = new Map<string, { score: number; reasons: Set<MatchReason> }>();
  const add = (slugs: string[], reason: MatchReason) => {
    slugs.forEach((slug, i) => {
      const cur = acc.get(slug) ?? {
        score: 0,
        reasons: new Set<MatchReason>(),
      };
      cur.score += 1 / (RRF_K + i);
      cur.reasons.add(reason);
      acc.set(slug, cur);
    });
  };
  add(fullText, "exact");
  add(semantic, "similar");
  return [...acc.entries()]
    .map(([slug, v]) => ({
      slug,
      score: v.score,
      matchReasons: [...v.reasons].sort(),
    }))
    .sort((a, b) => b.score - a.score);
}

function makeSnippet(text: string | null): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > SNIPPET_MAX ? `${clean.slice(0, SNIPPET_MAX)}…` : clean;
}

// The single curated entry point. cursor is an opaque offset into the fused list
// (a string integer) — the fused rank is recomputed per call (cheap at this
// scale), so paging just slices a stable ordering.
export async function searchCorpus(
  viewerId: string,
  query: string,
  opts: {
    scope?: "all" | "mine";
    limit?: number;
    cursor?: string;
    embedder?: QueryEmbedder;
  } = {},
): Promise<SearchPage> {
  const q = query.trim();
  if (!q) {
    return { items: [], nextCursor: null, partial: false };
  }

  const limit = Math.min(50, Math.max(1, opts.limit ?? 24));
  const offset = Math.max(0, Number.parseInt(opts.cursor ?? "0", 10) || 0);
  const scopeAll = (opts.scope ?? "all") === "all";

  const friendIds = scopeAll ? await friendIdsOf(viewerId) : [];
  const includePublic = scopeAll;

  const embedder = opts.embedder ?? defaultQueryEmbedder;
  const [ftSlugs, semSlugs] = await Promise.all([
    fullTextLeg(viewerId, q, friendIds, includePublic, FUSION_CANDIDATES),
    semanticLeg(viewerId, q, friendIds, includePublic, FUSION_CANDIDATES, embedder),
  ]);
  const partial = semSlugs === null;
  const fused = reciprocalRankFusion(ftSlugs, semSlugs ?? []);

  const pageRanked = fused.slice(offset, offset + limit);
  const hasMore = fused.length > offset + limit;

  // Hydrate the page's slugs with full post metadata, visibility-gated so a slug
  // the viewer can't actually read is dropped (defense in depth).
  const full = await listPostsBySlugsVisible(
    pageRanked.map((r) => r.slug),
    searchVisibilityWhere(viewerId, friendIds, includePublic),
  );
  const bySlug = new Map(full.map((p) => [p.slug, p]));

  const items: SearchHit[] = pageRanked.flatMap((r) => {
    const post = bySlug.get(r.slug);
    if (!post) return [];
    return [
      {
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        type: post.type,
        status: post.status,
        categories: post.categories.map((c) => ({
          slug: c.slug,
          name: c.name,
        })),
        tags: post.tags.map((t) => ({ slug: t.slug, name: t.name })),
        submittedBy: post.submittedBy,
        createdAt: post.createdAt.toISOString(),
        score: r.score,
        snippet: makeSnippet(post.excerpt ?? post.content),
        matchReasons: r.matchReasons,
      },
    ];
  });

  return {
    items,
    nextCursor: hasMore ? String(offset + limit) : null,
    partial,
  };
}
