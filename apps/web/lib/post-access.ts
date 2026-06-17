// Single source of truth for "who may READ one post through the signed-in
// cockpit" (the /api/app/posts/[slug] family + the (app)/posts/[slug] page).
//
// Today the rule is owner-only. This is deliberately the ONE place that decision
// lives so the policy can be widened later — e.g. when post sharing or
// org-visibility lands — by editing only this function, never the call sites.
// That's also why it is async even though the current rule needs no I/O: a
// future rule (look up a PostShare row, check org membership, honor a public
// flag) can add an `await` here without changing a single caller.
//
// IMPORTANT: this gates READ access only. Owner-only *mutations* (delete,
// assign-to-project, download source originals) must keep their own
// `post.submittedById === viewerId` checks — sharing a post for reading should
// never grant write/management rights.
import type { PostStatus } from "@repo/db";

// The minimal shape a post must expose to be authorized. Both findPostBySlug
// (PostWithRelations) and getCachedPost satisfy it structurally, so callers pass
// the post they already loaded — no extra query.
export type ReadableSubject = {
  submittedById: string | null;
  status: PostStatus;
};

// `viewerId` is the current session user id, or null when signed out.
export async function canReadPost(
  post: ReadableSubject,
  viewerId: string | null
): Promise<boolean> {
  // --- current rule: owner-only ---------------------------------------------
  if (viewerId != null && post.submittedById === viewerId) {
    return true;
  }

  // --- future extension points (intentionally empty today) ------------------
  // When sharing arrives, add the checks here and nowhere else, e.g.:
  //   if (await isPostSharedWith(post, viewerId)) return true;
  //   if (post.status === PostStatus.PUBLISHED && allowPublicReadInCockpit) ...
  // Published posts already have a public home at /listing/[slug]; the cockpit
  // stays owner-only until a deliberate sharing feature opens it up.

  return false;
}
