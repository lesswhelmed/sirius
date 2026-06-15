"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Owner-only post deletion. Confirms, calls DELETE, then returns to the catalog.
// Deleting permanently removes the post AND its retained source originals.
export function DeletePostButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (busy) return;
    const ok = window.confirm(
      "Delete this post and its source files permanently? This cannot be undone."
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/app/posts/${slug}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`delete failed (${res.status})`);
      }
      router.push("/catalog");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-baseline gap-2">
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error ? (
        <span className="font-mono text-[10px] text-[var(--color-accent)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
