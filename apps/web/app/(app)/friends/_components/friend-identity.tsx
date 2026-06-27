"use client";

import Image from "next/image";
import { useState } from "react";

// Shared friend identity render — the avatar (image or serif monogram) + the
// name/@handle span — lifted verbatim from friends-list.tsx so the friends list,
// the create/edit-group dialog, and the groups manager all render a friend
// identically (DRY x3). Pure presentation: no links, no actions.

// A serif monogram in a hairline circle — a calm, image-free avatar that scales
// to any list length and matches the editorial system.
export function Monogram({ name }: { name: string }) {
  const initial = (name.trim()[0] ?? "·").toUpperCase();
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-sunken)] font-display text-[16px] text-[var(--fg-muted)]"
    >
      {initial}
    </span>
  );
}

// The friend's profile image when present, else the monogram. Remote URLs stay
// unoptimized (mirrors PostImage) so a third-party avatar host can't fail the
// Next optimizer; a load error quietly degrades to the monogram.
export function Avatar({
  name,
  image,
}: {
  name: string;
  image?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) return <Monogram name={name} />;
  return (
    <Image
      src={image}
      alt=""
      aria-hidden
      width={36}
      height={36}
      unoptimized={!image.startsWith("/")}
      onError={() => setFailed(true)}
      className="size-9 shrink-0 rounded-full border border-[var(--color-rule)] object-cover"
    />
  );
}

// Name + @handle, baseline-aligned. `hoverAccent` shifts the name to the accent
// on a parent group-hover (used by the linked friends-list row).
export function FriendName({
  name,
  handle,
  size = 18,
  hoverAccent = false,
}: {
  name: string;
  handle: string | null;
  size?: number;
  hoverAccent?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span
        className={`truncate font-display text-[var(--fg)] ${
          hoverAccent ? "transition-colors group-hover:text-[var(--color-accent)]" : ""
        }`}
        style={{ fontSize: size }}
      >
        {name}
      </span>
      {handle ? (
        <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
          @{handle}
        </span>
      ) : null}
    </span>
  );
}
