"use client";

import { useState } from "react";

// Copy-to-clipboard for the user's invite link (`<origin>/u/<handle>`). The
// origin is read at click time from the browser so the link always matches the
// host the user is on (sirius.local in dev, the prod domain in prod).
export function ShareHandle({ handle }: { handle: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    const url = `${window.location.origin}/u/${handle}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can reject (permissions / insecure context) — leave the link
      // visible below so the user can copy it manually.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <button
        type="button"
        onClick={onClick}
        className="border border-[var(--color-rule-emphatic)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >
        {copied ? "Copied ✓" : "Copy invite link"}
      </button>
      <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
        /u/{handle}
      </span>
    </div>
  );
}
