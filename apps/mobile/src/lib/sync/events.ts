// Wire payload types for the sync engine. These mirror the server contracts in
// packages/db (listPostsChangedSince's PostChangesResult and notify.ts's
// PostChangeNotification). Dates arrive as ISO strings over JSON.
import type { PostImage } from "@/lib/db/schema";

// One post in the delta feed (GET /api/app/posts/changes). `content` is the
// server's body field; the mirror stores it as `body`.
export type PostDelta = {
  id: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string | null;
  type: string;
  status: string;
  imageUrl: string | null;
  images: PostImage[] | null;
  tags: string[];
  categories: string[];
  sourceRecordId: string | null;
  // The originating IngestSubmission id(s). The reconcile match key for an
  // optimistic row: `posts.submissionId` ∈ this set. Stable across provider
  // paths that override `sourceRecordId` to a native id (Twitter tweetId,
  // Instagram shortcode), which is why it — not `sourceRecordId` — is the
  // reliable link for url/note captures. Empty for non-ingest posts.
  sourceSubmissionIds: string[];
  // Provider provenance + structured digest (e.g. github repo stats), mirrored
  // so the catalog row can render the repo chip without re-fetching the source.
  providerId: string;
  contentDigest: Record<string, unknown> | null;
  // "full" | "stub" — whether the body got the AI pass (degraded-bookmark
  // marker). Mirrored so owner surfaces can badge stub posts.
  aiTreatment: string;
  // Server-computed (gemini-embedding-2) retrieval vector. Mirrored into the
  // on-device post_vectors index by reconcile so "ask my posts" can semantic-search
  // WITHOUT embedding documents on-device. Null until the worker has embedded the
  // post. embeddingModel + embeddingDim identify the vector space (the same id the
  // query-embed endpoint returns) so the device ranks a query only against
  // same-space document vectors.
  embedding: number[] | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PostChange =
  | { op: "upsert"; post: PostDelta }
  | { op: "delete"; id: string; deletedAt: string };

export type PostChangesResult = {
  changes: PostChange[];
  nextCursor: string | null;
  hasMore: boolean;
};

// The SSE nudge (event: change). Lightweight by design — the client reacts by
// pulling the delta feed rather than trusting the nudge for post data.
export type PostChangeNotification = {
  op: "upsert" | "delete";
  postId: string;
  slug: string;
  ownerId: string | null;
  sourceRecordId: string | null;
  updatedAt: string;
};

// One comment in the delta feed (GET /api/app/comments/changes). Mirrors
// packages/db/comments.ts's CommentDelta; the mirror stores authorLabel/authorId
// denormalized (the device has no user table to join against).
export type CommentDelta = {
  id: string;
  postId: string;
  postSlug: string;
  authorKind: "USER" | "AGENT";
  authorId: string | null;
  authorLabel: string | null;
  authorImage: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type CommentChange =
  | { op: "upsert"; comment: CommentDelta }
  | { op: "delete"; id: string; deletedAt: string };

export type CommentChangesResult = {
  changes: CommentChange[];
  nextCursor: string | null;
  hasMore: boolean;
};

// One reflection prompt in the delta feed (GET /api/app/reflections/changes).
// Mirrors packages/db/reflections.ts's ReflectionPromptDelta. Dates arrive as
// ISO strings over JSON.
export type ReflectionPromptDelta = {
  id: string;
  postId: string;
  postSlug: string;
  batchId: string;
  order: number;
  question: string;
  rationale: string | null;
  status: "active" | "superseded";
  createdAt: string;
  updatedAt: string;
};

// One reflection response (the owner's answer) in the same feed. `hasAudio`
// flags a retained audio original streamable via the owner-gated audio route.
export type ReflectionResponseDelta = {
  id: string;
  promptId: string;
  postId: string;
  postSlug: string;
  body: string;
  hasAudio: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReflectionPromptChange =
  | { op: "upsert"; prompt: ReflectionPromptDelta }
  | { op: "delete"; id: string; deletedAt: string };

export type ReflectionResponseChange =
  | { op: "upsert"; response: ReflectionResponseDelta }
  | { op: "delete"; id: string; deletedAt: string };

// Prompts + responses ride ONE feed with a single ISO watermark (max updatedAt
// across both tables) so the device can't observe a response before its prompt
// for long.
export type ReflectionChangesResult = {
  promptChanges: ReflectionPromptChange[];
  responseChanges: ReflectionResponseChange[];
  nextCursor: string | null;
  hasMore: boolean;
};
