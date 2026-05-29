"use client";

import { useState } from "react";

// Published posts are publicly viewable at /listing/[slug]; that's the link
// we share. Uses the Web Share sheet when available, else copies to clipboard.
export function ShareButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  const onShare = async () => {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/listing/${slug}`
        : `/listing/${slug}`;

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // user dismissed the sheet, or share failed — fall through to copy
      }
    }

    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      window.isSecureContext
    ) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        // clipboard blocked — fall through to prompt
      }
    }

    window.prompt("Copy this link:", url);
  };

  return (
    <button
      type="button"
      onClick={onShare}
      className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
    >
      <span aria-hidden="true">↗</span>
      {copied ? "Copied" : "Share"}
    </button>
  );
}
