"use client";

import { useState, useTransition } from "react";

// GROUP is the share-groups audience; this 3-chip control renders only the base
// tiers and is superseded by AudiencePicker (Phase B) for GROUP. Kept in the
// union so post.visibility (now possibly GROUP) flows through ColophonTabs.
export type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC" | "GROUP";

const OPTIONS: { value: Visibility; label: string; hint: string }[] = [
  { value: "PRIVATE", label: "Private", hint: "Only you" },
  { value: "FRIENDS", label: "Friends", hint: "People you've added" },
  { value: "PUBLIC", label: "Public", hint: "Anyone signed in" },
];

// Sets a post's read visibility. Clones the AssignToProject optimistic +
// revert-on-failure pattern, rendered as a 3-chip radiogroup (the Stitch
// "Ledger Editorial" visibility control). Owner-only — render null otherwise.
export function VisibilityControl({
  slug,
  currentVisibility,
  canEdit,
}: {
  slug: string;
  currentVisibility: Visibility;
  canEdit: boolean;
}) {
  const [value, setValue] = useState<Visibility>(currentVisibility);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  if (!canEdit) {
    return null;
  }

  const choose = (next: Visibility) => {
    if (next === value) return;
    const previous = value;
    setValue(next); // optimistic
    setError(false);
    start(async () => {
      try {
        const res = await fetch(`/api/app/posts/${slug}/visibility`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ visibility: next }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        setValue(previous); // revert
        setError(true);
      }
    });
  };

  const activeHint = OPTIONS.find((o) => o.value === value)?.hint ?? "";

  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        Visibility
      </p>
      <div
        role="radiogroup"
        aria-label="Post visibility"
        className="flex flex-wrap gap-1.5"
      >
        {OPTIONS.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={pending}
              onClick={() => choose(o.value)}
              className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors disabled:opacity-50 ${
                selected
                  ? "bg-[var(--color-accent)] text-[var(--color-paper)]"
                  : "border border-[var(--color-rule)] text-[var(--fg-muted)] hover:border-[var(--color-accent)] hover:text-[var(--fg)]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="font-display italic text-[13px] text-[var(--fg-subtle)]">
        {activeHint}
      </p>
      {error ? (
        <p
          role="alert"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
        >
          Couldn’t save — try again
        </p>
      ) : null}
    </div>
  );
}
