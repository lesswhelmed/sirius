// Owner-initiated post deletion. Kept out of posts.ts (which is query-only by
// convention) because this performs writes. Deleting a post also removes its
// source IngestSubmission rows so the unique contentHash doesn't block a later
// re-ingest of the same bytes, and returns the retained-file paths so the caller
// (the web DELETE route) can remove the originals from disk.
import { prisma } from "./index";

export type DeletedSource = {
  submissionId: string;
  submittedById: string | null;
  retainedFilePath: string | null;
};

export type DeletePostResult =
  | { ok: false; reason: "not-found" | "forbidden" }
  | { ok: true; deletedSources: DeletedSource[] };

// Verifies ownership, deletes the post (cascades drop its embedding, category
// matches, saves, and views) and its source submissions, and returns the
// retained originals so the caller can unlink them from disk.
export async function deletePostAndSources(
  slug: string,
  ownerId: string
): Promise<DeletePostResult> {
  const post = await prisma.post.findUnique({
    where: { slug },
    select: { id: true, submittedById: true },
  });
  if (!post) {
    return { ok: false, reason: "not-found" };
  }
  if (post.submittedById !== ownerId) {
    return { ok: false, reason: "forbidden" };
  }

  const sources = await prisma.ingestSubmission.findMany({
    where: { resultPostId: post.id },
    select: { id: true, submittedById: true, retainedFilePath: true },
  });

  // Delete submissions first (resultPostId is SetNull, so they would otherwise
  // be orphaned with a dangling contentHash), then the post itself.
  await prisma.$transaction([
    prisma.ingestSubmission.deleteMany({ where: { resultPostId: post.id } }),
    prisma.post.delete({ where: { id: post.id } }),
  ]);

  return {
    ok: true,
    deletedSources: sources.map((s) => ({
      submissionId: s.id,
      submittedById: s.submittedById,
      retainedFilePath: s.retainedFilePath,
    })),
  };
}
