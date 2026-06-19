// Per-user bookmarks ("Save to Library"). Writes live here, not in posts.ts
// (which is query-only by contract).
import { prisma } from "./index";

export async function savePost(userId: string, postId: string): Promise<void> {
  // Idempotent: a repeated save is a no-op thanks to @@unique([userId, postId]).
  await prisma.savedPost.upsert({
    where: { userId_postId: { userId, postId } },
    create: { userId, postId },
    update: {},
  });
}

export async function unsavePost(
  userId: string,
  postId: string,
): Promise<void> {
  // deleteMany so a missing row is a no-op (idempotent unsave).
  await prisma.savedPost.deleteMany({ where: { userId, postId } });
}

export async function isPostSaved(
  userId: string,
  postId: string,
): Promise<boolean> {
  const count = await prisma.savedPost.count({
    where: { userId, postId },
  });
  return count > 0;
}
