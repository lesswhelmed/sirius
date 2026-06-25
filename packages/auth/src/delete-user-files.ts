// Best-effort purge of a deleted user's on-disk files. The Prisma schema
// cascades every user-owned ROW (posts, submissions, archive requests, …) when
// the User is deleted, but the retained originals and built archive zips live
// OUTSIDE the database — under ORIGINALS_DIR / ARCHIVES_DIR — so they must be
// removed explicitly. Both trees are bucketed by userId (see the worker's
// originals-paths.ts and run-archive.ts: `join(resolveOriginalsDir(), userId)`
// and `join(resolveArchivesDir(), userId)`), so a single recursive rm of each
// user bucket removes everything that user ever uploaded or exported.
//
// This is wired into better-auth's `user.deleteUser.beforeDelete` hook, which
// runs in the web process (where auth is mounted), so the cwd-relative defaults
// below resolve the same way as apps/web/lib/originals/originals-paths.ts. In
// production ORIGINALS_DIR / ARCHIVES_DIR are set via env and take precedence.
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

function resolveOriginalsDir(): string {
  const override = process.env.ORIGINALS_DIR?.trim();
  return (
    override ||
    resolve(process.cwd(), "..", "..", "private-uploads", "originals")
  );
}

function resolveArchivesDir(): string {
  const override = process.env.ARCHIVES_DIR?.trim();
  return (
    override ||
    resolve(process.cwd(), "..", "..", "private-uploads", "archives")
  );
}

// Remove every retained original and archive zip belonging to a user. Never
// throws — a missing bucket (a user who never uploaded anything) is fine, and a
// file-system error must not block the account deletion itself.
export function purgeUserFiles(userId: string): void {
  if (!userId) return;
  for (const dir of [resolveOriginalsDir(), resolveArchivesDir()]) {
    try {
      rmSync(join(dir, userId), { recursive: true, force: true });
    } catch {
      // best-effort; deletion proceeds regardless
    }
  }
}
