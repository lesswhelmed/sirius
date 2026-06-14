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
