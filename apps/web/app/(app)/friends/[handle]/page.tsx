// A friend's catalog inside the signed-in cockpit: the PUBLISHED posts a friend
// shared (visibility FRIENDS or PUBLIC). Reached from the Friends list, which
// links each row here at /friends/<handle>.
//
// Access is gated PER REQUEST on an accepted friendship — NOT through the cached
// public storefront (getCachedStorefront), which returns every published post
// and is a cross-request `use cache` (it would leak a friend's PRIVATE posts and
// is the exact shape that caused a past cross-account catalog leak). We resolve
// the handle, verify areFriends() live, and read the friendship-scoped query
// listFriendCatalog (FRIENDS|PUBLIC, published-only) directly. Unknown handle,
// self, or non-friend all 404 so the page never reveals whether a user or
// friendship exists.
import { areFriends, findUserByHandle, listFriendCatalog } from "@repo/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateDisplay } from "../../../../lib/date-display";
import { requireSession } from "../../../../lib/session";
import { PostImage } from "../../../_chrome/post-image";

export default async function FriendCatalogPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const session = await requireSession(`/friends/${handle}`);

  const user = await findUserByHandle(handle);
  if (
    !user ||
    user.id === session.user.id ||
    !(await areFriends(session.user.id, user.id))
  ) {
    notFound();
  }

  const posts = await listFriendCatalog({ friendId: user.id, limit: 60 });

  return (
    <section className="mx-auto max-w-[960px]">
      <Link
        href="/friends"
        className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)] underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
      >
        ← Friends
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 hairline-b pb-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Catalog · @{user.handle}
          </p>
          <h1 className="mt-1 font-display italic text-[44px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[56px]">
            {user.name}
            <span className="text-[var(--color-accent)]">.</span>
          </h1>
          {user.bio ? (
            <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
              {user.bio}
            </p>
          ) : null}
          {user.location ? (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
              {user.location}
            </p>
          ) : null}
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-display italic text-[36px] leading-none text-[var(--color-accent)] nums-oldstyle">
            {posts.items.length}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            shared
          </span>
        </div>
      </header>

      {posts.items.length === 0 ? (
        <div className="mt-10 border-y border-[var(--color-rule)] py-20 text-center">
          <p className="font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">
            {user.name} hasn’t shared anything yet.
          </p>
        </div>
      ) : (
        <ul className="mt-10 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {posts.items.map((post) => (
            <li key={post.id}>
              <Link href={`/listing/${post.slug}`} className="group block">
                <div className="relative aspect-[4/5] w-full overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunken)]">
                  <PostImage
                    src={post.imageUrl}
                    alt={post.title}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                </div>
                <div className="mt-3">
                  <h2 className="font-display text-[20px] leading-tight tracking-[-0.005em] text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)]">
                    {post.title}
                  </h2>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
                    <DateDisplay value={post.originalDate ?? post.createdAt} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
