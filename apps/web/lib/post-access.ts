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
import { isPostSharedWith, PostStatus, PostVisibility } from "@repo/db";

import { PUBLIC_CATALOG_ENABLED } from "./features";

// The minimal shape a post must expose to be authorized. Both findPostBySlug
// (PostWithRelations) and getCachedPost satisfy it structurally, so callers pass
// the post they already loaded — no extra query. findPostAttributionBySlug also
// returns exactly these fields for the lightweight mutation/comment routes.
export type ReadableSubject = {
  submittedById: string | null;
  status: PostStatus;
  visibility: PostVisibility;
};

// `viewerId` is the current session user id, or null when signed out.
//
// This is the SINGLE place the read policy lives. Three tiers, owner first:
//   1. Owner reads anything they own (any status/visibility).
//   2. FRIENDS sharing — a published FRIENDS post the viewer is friends with.
//      The friendship is checked live per request (isPostSharedWith → areFriends),
//      never cached, so unfriending revokes access immediately.
//   3. PUBLIC — a published PUBLIC post, but only while the cross-user catalog is
//      switched on (PUBLIC_CATALOG_ENABLED). Default-PRIVATE posts mean flipping
//      that flag exposes nothing until an owner deliberately marks a post PUBLIC.
//
// READ only. Owner-only mutations (delete, assign-to-project, download originals,
// set visibility) keep their own `submittedById === viewerId` checks — sharing a
// post for reading must never grant write/management rights.
export async function canReadPost(
  post: ReadableSubject,
  viewerId: string | null,
): Promise<boolean> {
  if (viewerId != null && post.submittedById === viewerId) {
    return true;
  }

  if (await isPostSharedWith(post, viewerId)) {
    return true;
  }

  if (
    PUBLIC_CATALOG_ENABLED &&
    post.visibility === PostVisibility.PUBLIC &&
    post.status === PostStatus.PUBLISHED
  ) {
    return true;
  }

  return false;
}
