// The shared react-query for pending friend requests. ONE cache entry under
// ["friend-requests"] backs both the People-manager list (friends.tsx) AND the
// three incoming-request badges (nav tab, feed header, People segment), so an
// accept/decline invalidation (`invalidateQueries(["friend-requests"])`) refreshes
// every surface at once. The mapped `requests` array (both directions) feeds the
// list; `incomingCount` — incoming-only, straight from the server's single source
// of truth countIncomingRequests — feeds the badges without overcounting outgoing
// pendings.
import { useQuery } from "@tanstack/react-query";

import type { Friend } from "@/components/friend-row";
import { apiGet } from "@/lib/api";

export const FRIEND_REQUESTS_KEY = ["friend-requests"] as const;

export type FriendRequest = Friend & { direction: "incoming" | "outgoing" };

// The API returns pending requests as `{ user, direction, createdAt }` with the
// peer nested under `user` (see packages/db listPendingRequests); we flatten it
// here so `item.name` renders and accept/decline targets the peer's id.
type RawRequest = {
  user: { id: string; name: string; handle: string | null };
  direction: "incoming" | "outgoing";
};

export type FriendRequestsData = {
  requests: FriendRequest[];
  incomingCount: number;
};

async function fetchFriendRequests(): Promise<FriendRequestsData> {
  const { requests, incomingCount } = await apiGet<{
    requests: RawRequest[];
    incomingCount: number;
  }>("/api/app/friends/requests");
  return {
    requests: requests.map<FriendRequest>((r) => ({
      id: r.user.id,
      name: r.user.name,
      handle: r.user.handle,
      direction: r.direction,
    })),
    incomingCount,
  };
}

// Full pending-requests query (list + count). Used by the People manager.
export function useFriendRequests() {
  return useQuery({
    queryKey: FRIEND_REQUESTS_KEY,
    queryFn: fetchFriendRequests,
  });
}

// Just the incoming count (0 while loading / when none) — an observer of the same
// cache entry, so it shares fetches with useFriendRequests and reacts to the same
// invalidations. Backs the nav-tab, feed-header, and People-segment badges.
export function useIncomingRequestCount(): number {
  const { data } = useQuery({
    queryKey: FRIEND_REQUESTS_KEY,
    queryFn: fetchFriendRequests,
    select: (d) => d.incomingCount,
  });
  return data ?? 0;
}
