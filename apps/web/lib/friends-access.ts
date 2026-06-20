import { friendIdsOf } from "@repo/db";
import { cache } from "react";

// Per-request memo of "whose FRIENDS posts may this viewer see". A page that
// renders several posts (each running canReadPost → areFriends) or composes the
// friends feed would otherwise hit the DB repeatedly; React cache() collapses
// those into one round-trip per request.
//
// Deliberately NOT a `use cache` (cross-request) cache: friendship is personalized
// and revocation-sensitive — an unfriend must take effect on the very next
// request, so this memo lives only for the duration of one request.
export const getViewerFriendIds = cache(
  async (viewerId: string): Promise<string[]> => {
    return friendIdsOf(viewerId);
  },
);
