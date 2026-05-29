// Post view tracking + read-side stats. Writes (recordPostView) live here
// rather than in posts.ts (query-only by contract).
import { prisma } from "./index";

export async function recordPostView(
  postId: string,
  viewerId?: string | null
): Promise<void> {
  await prisma.postView.create({
    data: { postId, viewerId: viewerId ?? null },
  });
}

export interface PostViewStats {
  totalViews: number;
  uniqueViewers: number;
  inquiries: number;
}

export async function getPostViewStats(
  postId: string
): Promise<PostViewStats> {
  const [totalViews, distinctViewers, inquiries] = await Promise.all([
    prisma.postView.count({ where: { postId } }),
    prisma.postView.groupBy({
      by: ["viewerId"],
      where: { postId, viewerId: { not: null } },
    }),
    prisma.inquiry.count({ where: { postId } }),
  ]);

  return {
    totalViews,
    uniqueViewers: distinctViewers.length,
    inquiries,
  };
}
