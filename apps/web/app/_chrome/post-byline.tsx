"use client";

import Link from "next/link";
import type { SubmitterSummary } from "@repo/db";
import {
  Avatar,
  FriendName,
} from "../(app)/friends/_components/friend-identity";

// Author attribution for a post: avatar + display name + @handle. Shown on the
// Friends feed (whose post is this?) and the post detail header. When the author
// has a handle it links to their shareable profile at /u/[handle]; otherwise it
// renders as plain text (a handle-less account has no profile route).
//
// MUST render OUTSIDE any wrapping post <Link> — it emits its own anchor, and
// nested anchors are invalid HTML.
export function PostByline({
  author,
  avatarSize = 28,
  nameSize = 15,
  isSelf = false,
}: {
  author: SubmitterSummary;
  avatarSize?: number;
  nameSize?: number;
  // When the post is the viewer's own, append a quiet "(you)" so a self-authored
  // row in the merged feed is unmistakable (it also carries an audience badge).
  isSelf?: boolean;
}) {
  const inner = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={author.name} image={author.image} size={avatarSize} />
      <FriendName name={author.name} handle={author.handle} size={nameSize} />
      {isSelf ? (
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--fg-subtle)]">
          (you)
        </span>
      ) : null}
    </span>
  );
  if (!author.handle) {
    return inner;
  }
  return (
    <Link
      href={`/u/${author.handle}`}
      className="inline-flex max-w-full rounded-sm transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-ring)]"
    >
      {inner}
    </Link>
  );
}
