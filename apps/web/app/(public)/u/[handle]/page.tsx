// apps/web/app/(public)/u/[handle]/page.tsx
import type { Metadata } from "next";
import { findUserByHandle, friendshipState } from "@repo/db";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionOrNull } from "../../../../lib/session";
import { SITE_URL } from "../../../../lib/site";
import { APP_STORE_URL } from "../../../(marketing)/constants";
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

export default async function InvitePage({
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
