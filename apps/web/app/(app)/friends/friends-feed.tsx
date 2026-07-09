import { blockedIdsFor, listVisibleToViewer, publicTierPolicy } from "@repo/db";
import Link from "next/link";
import {
  ANONYMOUS_CATALOG_ENABLED,
  PUBLIC_CATALOG_ENABLED,
} from "../../../lib/features";
import { getViewerFriendIds } from "../../../lib/friends-access";
import { CatalogCard } from "../../(public)/catalog/catalog-card";

const FEED_PAGE = 48;

// The merged Friends feed: the viewer's own shared posts interleaved with
// friends'/public posts, newest first. Owner-inclusive (no friendsOnly) so the
// owner sees their own shared work badged with its audience.
export async function FriendsFeed({ userId }: { userId: string }) {
  // Blocked-author exclusion (both directions) — the db layer defaults
  // blockedIds to [], so the feed must pass the real set (App Store 1.2 Part C).
  const [friendIds, blockedIds] = await Promise.all([
    getViewerFriendIds(userId),
    blockedIdsFor(userId),
  ]);
  // Signed-in surface: cross-user PUBLIC admission comes from the shared PUBLIC
  // policy (same signed-in tier as the feed route + canReadPost), not a raw flag.
  const { signedInPublic } = publicTierPolicy({
    publicCatalogEnabled: PUBLIC_CATALOG_ENABLED,
    anonymousCatalogEnabled: ANONYMOUS_CATALOG_ENABLED,
  });
  const { items } = await listVisibleToViewer({
    viewerId: userId,
    friendIds,
    blockedIds,
    includePublic: signedInPublic,
    limit: FEED_PAGE,
  });

  if (items.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
        <p
          aria-hidden="true"
          className="font-display italic text-[56px] leading-none text-[var(--color-rule-strong)]"
        >
          ∅
        </p>
        <p className="mt-5 font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">
          Nothing shared yet.
        </p>
        <p className="mt-3 text-[15px] text-[var(--fg-subtle)]">
          Share a post with <em>Friends</em> or a group, or add people on the
          People tab.
        </p>
        <Link
          href="/friends?tab=people"
          className="mt-4 text-[var(--color-accent)] underline underline-offset-4"
        >
          Find friends
        </Link>
      </div>
    );
  }

  return (
    <ul>
      {items.map((post) => (
        <li
          key={post.id}
          className="border-b border-[var(--color-rule)] transition-colors hover:bg-[var(--color-paper-raised)]/40"
        >
          <CatalogCard post={post} showAuthor viewerId={userId} />
        </li>
      ))}
    </ul>
  );
}
