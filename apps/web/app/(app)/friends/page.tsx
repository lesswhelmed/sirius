import { listFriends, listPendingRequests, listShareGroups } from "@repo/db";
import { requireSession } from "../../../lib/session";
import type { GroupSummary } from "../../../lib/groups/types";
import { FriendsShell } from "./friends-shell";
import type { FriendItem, RequestItem } from "./friends-list";

export default async function FriendsPage() {
  const session = await requireSession("/friends");
  const [friends, requests, groups] = await Promise.all([
    listFriends(session.user.id),
    listPendingRequests(session.user.id),
    listShareGroups(session.user.id),
  ]);

  const friendItems: FriendItem[] = friends.map((f) => ({
    id: f.id,
    name: f.name,
    handle: f.handle,
    image: f.image,
    friendsSince: f.friendsSince ? f.friendsSince.toISOString() : null,
  }));
  const requestItems: RequestItem[] = requests.map((r) => ({
    id: r.user.id,
    name: r.user.name,
    handle: r.user.handle,
    image: r.user.image,
    direction: r.direction,
  }));
  // Serialize the @repo/db Date fields to the client-friendly GroupSummary shape.
  const groupItems: GroupSummary[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    visibility: g.visibility,
    memberCount: g.memberCount,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  }));

  return (
    <section className="mx-auto max-w-[640px]">
      <header className="hairline-b pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Section VI — Company
        </p>
        <h1 className="mt-1 font-display italic text-[36px] leading-[0.98] tracking-[-0.01em] sm:text-[44px]">
          Your friends
          <span className="text-[var(--color-accent)]">.</span>
        </h1>
      </header>

      <div className="mt-8">
        <FriendsShell
          friends={friendItems}
          requests={requestItems}
          groups={groupItems}
        />
      </div>
    </section>
  );
}
