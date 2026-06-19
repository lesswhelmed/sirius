"use client";

import { useState, useTransition } from "react";

export function SaveButton({
  slug,
  initialSaved,
  canSave,
}: {
  slug: string;
  initialSaved: boolean;
  canSave: boolean;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, start] = useTransition();

  if (!canSave) {
    return (
      <span
        className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-faint)]"
        title="Sign in to save"
      >
        <span aria-hidden="true">✦</span>
        Save
      </span>
    );
  }

  const toggle = () => {
    const nextSaved = !saved;
    setSaved(nextSaved); // optimistic
    start(async () => {
      try {
        const res = await fetch(`/api/app/posts/${slug}/save`, {
          method: nextSaved ? "POST" : "DELETE",
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { saved: boolean };
        setSaved(data.saved);
      } catch {
        setSaved(!nextSaved); // revert on failure
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      disabled={pending}
      className={`inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors ${
        saved
          ? "text-[var(--color-accent)]"
          : "text-[var(--fg-muted)] hover:text-[var(--color-accent)]"
      }`}
    >
      <span aria-hidden="true">{saved ? "✦" : "✧"}</span>
      {saved ? "Saved" : "Save to Library"}
    </button>
  );
}
