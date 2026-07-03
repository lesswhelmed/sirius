"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The viewer's blocked-users list (App Store Guideline 1.2 Part C). The rows
// are server-fetched (listBlocks in the settings page) and passed in serialized;
// this client shell only owns the Unblock action — DELETE the block, then
// router.refresh() so the server-rendered list (and any feed content the
// unblock restores) updates.

export type BlockedUserItem = {
  id: string;
  name: string;
  handle: string | null;
  blockedAt: string;
};

export function BlockedUsersSection({ items }: { items: BlockedUserItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function unblock(userId: string) {
    if (busyId) return;
    setBusyId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/app/users/${userId}/block`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`unblock failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unblock failed");
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="font-display italic text-[15px] text-[var(--fg-subtle)]">
        You haven’t blocked anyone.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-0">
        {items.map((user) => (
          <li
            key={user.id}
            className="hairline-b flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
          >
            <span className="min-w-0">
              <span className="font-body text-[15px] text-[var(--fg)]">
                {user.name}
              </span>
              {user.handle ? (
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
                  @{user.handle}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => unblock(user.id)}
              disabled={busyId !== null}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
            >
              {busyId === user.id ? "Unblocking…" : "Unblock"}
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-accent)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
