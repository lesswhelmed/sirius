// One-off cleanup for orphaned flat Category rows — rows that label zero posts.
// Historically, post-writer created flat Category rows keyed by the full
// slash-path (e.g. "lifestyle/beekeeping"); the classification resolver then
// relinked posts to canonical leaf names ("beekeeping") via `set: []`, orphaning
// the path-named rows without ever deleting them. That seam is now fixed
// (post-writer uses leaf names + assign-org prunes after the relink), but
// existing rows from before the fix remain. Run this once to remove them.
//
// Idempotent and safe: a flat Category exists only to label posts and is created
// atomically alongside its first link, so a 0-post row can only be an orphan.
//
// Run (from repo root so root .env loads): bun run apps/worker/scripts/cleanup-orphan-categories.ts
import { deleteOrphanCategories } from "@repo/db";

async function main(): Promise<void> {
  const removed = await deleteOrphanCategories();
  console.log(
    `cleanup complete: removed ${removed} orphan categor${removed === 1 ? "y" : "ies"}`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
