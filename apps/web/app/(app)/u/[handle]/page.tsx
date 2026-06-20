import { findUserByHandle, friendshipState } from "@repo/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionOrNull } from "../../../../lib/session";
import { AddFriendButton } from "../../../(public)/catalog/[handle]/add-friend-button";

// Invite landing page: someone shared `/u/<handle>` and a signed-in viewer lands
// here to add them as a friend. Lives in the session-gated `(app)` group, so the
// group layout handles the sign-in-then-return flow for logged-out visitors. This
// is deliberately separate from `/catalog/[handle]` so it works regardless of
// PUBLIC_CATALOG_ENABLED (the public catalog is intentionally gated off).
export default async function AddFriendInvitePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const target = await findUserByHandle(handle);
  if (!target || !target.handle) {
    notFound();
  }

  // Session is guaranteed by the (app) group layout's requireSession.
  const viewerId = (await getSessionOrNull())!.user.id;
  const isSelf = viewerId === target.id;
  const relState = isSelf
    ? null
    : await friendshipState(viewerId, target.id);

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
        {target.location ? (
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            {target.location}
          </p>
        ) : null}
      </header>

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
        ) : (
          <AddFriendButton
            userId={target.id}
            handle={target.handle}
            initialState={relState!}
          />
        )}
      </div>
    </section>
  );
}
