"use client";

import { useState, useTransition } from "react";

export type RelState = "self" | "none" | "outgoing" | "incoming" | "friends";

// The friendship CTA on a user's storefront header. Optimistic transitions
// between the four meaningful states; renders nothing for your own profile.
export function AddFriendButton({
  userId,
  handle,
  initialState,
}: {
  userId: string;
  handle: string;
  initialState: RelState;
}) {
  const [state, setState] = useState<RelState>(initialState);
  const [pending, start] = useTransition();

  if (state === "self") return null;

  const act = (next: RelState, fn: () => Promise<Response>) => {
    const previous = state;
    setState(next);
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        setState(previous);
      }
    });
  };

  const cls =
    "border border-[var(--color-rule)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors disabled:opacity-50";

  if (state === "none") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          act("outgoing", () =>
            fetch("/api/app/friends/requests", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ handle }),
            }),
          )
        }
        className={`${cls} bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)] hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)]`}
      >
        Add friend
      </button>
    );
  }

  if (state === "outgoing") {
    return (
      <span className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
          Pending ·
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act("none", () =>
              fetch(`/api/app/friends/${userId}`, { method: "DELETE" }),
            )
          }
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          Cancel
        </button>
      </span>
    );
  }

  if (state === "incoming") {
    return (
      <span className="flex items-baseline gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act("friends", () =>
              fetch(`/api/app/friends/requests/${userId}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "accept" }),
              }),
            )
          }
          className={`${cls} text-[var(--fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]`}
        >
          Accept
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act("none", () =>
              fetch(`/api/app/friends/requests/${userId}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "decline" }),
              }),
            )
          }
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          Decline
        </button>
      </span>
    );
  }

  // friends
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        act("none", () =>
          fetch(`/api/app/friends/${userId}`, { method: "DELETE" }),
        )
      }
      title="Remove friend"
      className="group font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-sage)] transition-colors hover:text-[var(--color-accent)]"
    >
      <span className="group-hover:hidden">Friends ✓</span>
      <span className="hidden group-hover:inline">Remove</span>
    </button>
  );
}
