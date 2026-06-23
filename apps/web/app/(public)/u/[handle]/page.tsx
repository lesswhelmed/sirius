// apps/web/app/(public)/u/[handle]/page.tsx
//
// One shareable profile URL with four viewer states:
//   - anonymous            → invite OG card + Get Sirius / sign-in
//   - self                 → "your invite link" + card
//   - signed-in, not-yet   → invite card + AddFriendButton
//   - signed-in, ACCEPTED  → the friend's bio/location + their shared catalog
//
// The friend branch reuses the per-request friendship gate (areFriends) and the
// friendship-scoped query (listFriendCatalog: FRIENDS|PUBLIC, published-only) —
// NEVER the cached public storefront, which would leak PRIVATE posts. This folds
// the former /friends/[handle] cockpit page into the canonical /u/[handle] URL
// so the link a user shares is the same link a friend browses.
import type { Metadata } from "next";
import {
  areFriends,
  findUserByHandle,
  friendshipState,
  listFriendCatalog,
} from "@repo/db";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateDisplay } from "../../../../lib/date-display";
import { getSessionOrNull } from "../../../../lib/session";
import { SITE_URL } from "../../../../lib/site";
import { APP_STORE_URL } from "../../../(marketing)/constants";
import { PostImage } from "../../../_chrome/post-image";
import { AddFriendButton } from "../../catalog/[handle]/add-friend-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const user = await findUserByHandle(handle);
  if (!user || !user.handle) return { title: "Sirius" };
  const name = user.name ?? `@${user.handle}`;
  const url = `${SITE_URL}/u/${user.handle}`;
  const card = `${url}/card`;
  const title = `Add ${name} on Sirius`;
  const description =
    user.bio ?? "My personal catalog of everything worth keeping.";
  return {
    title,
    description,
    alternates: { canonical: `/u/${user.handle}` },
    openGraph: {
      type: "profile",
      url,
      title,
      description,
      images: [{ url: card, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description, images: [card] },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const target = await findUserByHandle(handle);
  if (!target || !target.handle) notFound();

  const session = await getSessionOrNull();
  const viewerId = session?.user.id ?? null;
  const isSelf = viewerId === target.id;
  const relState =
    viewerId && !isSelf ? await friendshipState(viewerId, target.id) : null;

  // Accepted friend → render the catalog instead of the invite card. The live
  // areFriends() re-check matches the (retired) /friends/[handle] gate exactly.
  if (
    relState === "friends" &&
    viewerId &&
    (await areFriends(viewerId, target.id))
  ) {
    const posts = await listFriendCatalog({ friendId: target.id, limit: 60 });
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
              Catalog · @{target.handle}
            </p>
            <h1 className="mt-1 font-display italic text-[44px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[56px]">
              {target.name}
              <span className="text-[var(--color-accent)]">.</span>
            </h1>
            {target.bio ? (
              <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
                {target.bio}
              </p>
            ) : null}
            {target.location ? (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                {target.location}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-6">
            <AddFriendButton
              userId={target.id}
              handle={target.handle}
              initialState="friends"
            />
            <div className="flex items-baseline gap-2">
              <span className="font-display italic text-[36px] leading-none text-[var(--color-accent)] nums-oldstyle">
                {posts.items.length}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                shared
              </span>
            </div>
          </div>
        </header>

        {posts.items.length === 0 ? (
          <div className="mt-10 border-y border-[var(--color-rule)] py-20 text-center">
            <p className="font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">
              {target.name} hasn’t shared anything yet.
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

  // Otherwise: the invite landing (anonymous / self / not-yet-friend).
  return (
    <section className="mx-auto max-w-[560px]">
      <header className="hairline-b pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          {isSelf ? "Your invite link" : `Add a friend · @${target.handle}`}
        </p>
        <h1 className="mt-1 font-display italic text-[44px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[52px]">
          {target.name}
          <span className="text-[var(--color-accent)]">.</span>
        </h1>
        {target.bio ? (
          <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
            {target.bio}
          </p>
        ) : null}
      </header>

      <Image
        src={`/u/${target.handle}/card`}
        alt={`Add ${target.name ?? target.handle} on Sirius`}
        width={1200}
        height={630}
        className="mt-8 w-full rounded-lg border border-[var(--color-rule)]"
        unoptimized
      />

      <div className="mt-8">
        {isSelf ? (
          <p className="font-body text-[15px] leading-[1.7] text-[var(--fg-muted)]">
            This is your own invite link. Share it with friends so they can add
            you. Manage your{" "}
            <Link
              href="/friends"
              className="underline decoration-[var(--color-rule-strong)] underline-offset-4 transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
            >
              friends
            </Link>
            .
          </p>
        ) : viewerId ? (
          <AddFriendButton
            userId={target.id}
            handle={target.handle}
            initialState={relState!}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <a
              href={APP_STORE_URL}
              className="inline-flex w-fit border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-paper)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]"
            >
              Get Sirius
            </a>
            <Link
              href={`/sign-in?next=${encodeURIComponent(`/u/${target.handle}`)}`}
              className="w-fit font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)] underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
            >
              Sign in to add me
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
