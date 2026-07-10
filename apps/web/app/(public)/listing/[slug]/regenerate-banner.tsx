"use client";

import { useState, useTransition } from "react";

// Owner-only notice on a degraded "stub" bookmark post (the page renders this
// only when viewer === owner AND post.aiTreatment === "stub"). The button
// POSTs to /api/app/posts/[slug]/regenerate; the server re-checks ownership,
// stub-ness, and Pro entitlement — this component trusts nothing client-side.
type Notice =
  | { kind: "queued" }
  | { kind: "pro-required" }
  | { kind: "error"; message: string };

export function RegenerateBanner({ slug }: { slug: string }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isPending, startTransition] = useTransition();

  const onRegenerate = () => {
    if (!window.confirm("Regenerating replaces the current draft text.")) {
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const res = await fetch(`/api/app/posts/${slug}/regenerate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 202) {
        setNotice({ kind: "queued" });
        return;
      }
      if (res.status === 402) {
        setNotice({ kind: "pro-required" });
        return;
      }
      if (res.status === 409) {
        setNotice({ kind: "error", message: "This post can't be regenerated." });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setNotice({
        kind: "error",
        message: data.error ?? `Request failed (${res.status})`,
      });
    });
  };

  return (
    <div className="mb-8 border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)] p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        Bookmark
      </p>
      <p className="mt-2 font-display italic text-[16px] leading-[1.4] text-[var(--fg-muted)]">
        Saved as a bookmark — you were out of free AI generations.
      </p>
      {notice?.kind === "queued" ? (
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-accent)]">
          Regenerating — check back shortly
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isPending}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] underline underline-offset-4 transition-colors hover:text-[var(--color-accent-deep)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Regenerating…" : "Regenerate"}
          </button>
          {notice?.kind === "pro-required" ? (
            <span className="font-mono text-[11px] text-[var(--fg-muted)]">
              Regeneration is part of Sirius AI Pro — upgrade in the mobile app.
            </span>
          ) : null}
          {notice?.kind === "error" ? (
            <span className="font-mono text-[11px] text-[var(--fg-muted)]">
              {notice.message}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
