"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

export interface FriendItem {
  id: string;
  name: string;
  handle: string | null;
  // ISO string; present for accepted friends, absent/null for pending requests.
  friendsSince?: string | null;
}

export interface RequestItem extends FriendItem {
  direction: "incoming" | "outgoing";
}

// The interactive friends + requests lists. Optimistic mutations with
// revert-on-failure, mirroring assign-to-project's pattern. The server page
// passes the initial data; this owns the live state thereafter.
//
// Each accepted-friend row is a LINK to that friend's catalog (/friends/<handle>);
// the row's management action (Remove) is a sibling button OUTSIDE the link so we
// never nest a button in an anchor. A search field appears once the list grows,
// so the page scales from a handful of friends to hundreds.
export function FriendsList({
  initialFriends,
  initialRequests,
}: {
  initialFriends: FriendItem[];
  initialRequests: RequestItem[];
}) {
  const [friends, setFriends] = useState(initialFriends);
  const [requests, setRequests] = useState(initialRequests);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [, start] = useTransition();

  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");

  const filteredFriends = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.handle ? f.handle.toLowerCase().includes(q) : false),
    );
  }, [friends, query]);

  const run = (fn: () => Promise<Response>, revert: () => void) => {
    setError(null);
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        revert();
        setError("Something went wrong — try again.");
      }
    });
  };

  const accept = (r: RequestItem) => {
    setRequests((cur) => cur.filter((x) => x.id !== r.id));
    setFriends((cur) => [
      { id: r.id, name: r.name, handle: r.handle, friendsSince: null },
      ...cur,
    ]);
    run(
      () =>
        fetch(`/api/app/friends/requests/${r.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "accept" }),
        }),
      () => {
        setFriends((cur) => cur.filter((x) => x.id !== r.id));
        setRequests((cur) => [r, ...cur]);
      },
    );
  };

  const decline = (r: RequestItem) => {
    setRequests((cur) => cur.filter((x) => x.id !== r.id));
    run(
      () =>
        fetch(`/api/app/friends/requests/${r.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "decline" }),
        }),
      () => setRequests((cur) => [r, ...cur]),
    );
  };

  const cancel = (r: RequestItem) => {
    setRequests((cur) => cur.filter((x) => x.id !== r.id));
    run(
      () => fetch(`/api/app/friends/${r.id}`, { method: "DELETE" }),
      () => setRequests((cur) => [r, ...cur]),
    );
  };

  const remove = (f: FriendItem) => {
    setFriends((cur) => cur.filter((x) => x.id !== f.id));
    run(
      () => fetch(`/api/app/friends/${f.id}`, { method: "DELETE" }),
      () => setFriends((cur) => [f, ...cur]),
    );
  };

  const showSearch = friends.length > 5;

  return (
    <div className="space-y-12">
      {error ? (
        <p
          role="alert"
          className="border-l-2 border-[var(--color-accent)] pl-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
        >
          {error}
        </p>
      ) : null}

      <Section
        label="Requests"
        empty="No pending requests."
        count={incoming.length}
      >
        {incoming.map((r) => (
          <Row key={r.id} item={r}>
            <TextAction onClick={() => accept(r)}>Accept</TextAction>
            <TextAction onClick={() => decline(r)} muted>
              Decline
            </TextAction>
          </Row>
        ))}
      </Section>

      <Section
        label="Pending"
        empty="No outgoing requests."
        count={outgoing.length}
      >
        {outgoing.map((r) => (
          <Row key={r.id} item={r}>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-faint)]">
              Pending ·
            </span>
            <TextAction onClick={() => cancel(r)} muted>
              Cancel
            </TextAction>
          </Row>
        ))}
      </Section>

      <Section
        label="Friends"
        empty="No friends yet."
        count={friends.length}
      >
        {showSearch ? (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a friend by name or @handle"
            aria-label="Filter friends"
            className="mb-2 w-full border-0 border-b border-[var(--color-rule)] bg-transparent pb-2 font-display text-[16px] text-[var(--fg)] placeholder:text-[var(--fg-faint)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        ) : null}

        {filteredFriends.length === 0 ? (
          <p className="py-3 font-display italic text-[15px] text-[var(--fg-subtle)]">
            No friend matches “{query}”.
          </p>
        ) : (
          filteredFriends.map((f) => (
            <FriendRow key={f.id} item={f} onRemove={() => remove(f)} />
          ))
        )}
      </Section>
    </div>
  );
}

function Section({
  label,
  count,
  empty,
  children,
}: {
  label: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="hairline-t pt-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        {label}
        {count > 0 ? (
          <span className="ml-2 text-[var(--color-accent)]">{count}</span>
        ) : null}
      </p>
      {count === 0 ? (
        <p className="mt-4 font-display italic text-[15px] text-[var(--fg-subtle)]">
          {empty}
        </p>
      ) : (
        <ul className="mt-2 space-y-0">{children}</ul>
      )}
    </section>
  );
}

// A serif monogram in a hairline circle — a calm, image-free avatar that scales
// to any list length and matches the editorial system.
function Monogram({ name }: { name: string }) {
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

// An accepted-friend row: the avatar/name/handle/since region is one link to the
// friend's catalog; Remove is a sibling button so the anchor stays valid. A
// friend without a handle has no catalog URL, so it renders un-linked.
function FriendRow({
  item,
  onRemove,
}: {
  item: FriendItem;
  onRemove: () => void;
}) {
  const since = sinceLabel(item.friendsSince);
  const identity = (
    <>
      <Monogram name={item.name} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate font-display text-[19px] text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)]">
            {item.name}
          </span>
          {item.handle ? (
            <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
              @{item.handle}
            </span>
          ) : null}
        </span>
        {since ? (
          <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-faint)]">
            Since {since}
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <li className="hairline-b flex items-center justify-between gap-4 py-3.5">
      {item.handle ? (
        <Link
          href={`/friends/${item.handle}`}
          className="group flex min-w-0 flex-1 items-center gap-3"
        >
          {identity}
          <span className="ml-auto hidden whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-faint)] transition-colors group-hover:text-[var(--color-accent)] sm:inline">
            View catalog →
          </span>
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{identity}</span>
      )}
      <TextAction onClick={onRemove} muted>
        Remove
      </TextAction>
    </li>
  );
}

function Row({
  item,
  children,
}: {
  item: FriendItem;
  children: React.ReactNode;
}) {
  return (
    <li className="hairline-b flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
      <span className="flex min-w-0 items-center gap-3">
        <Monogram name={item.name} />
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-[18px] text-[var(--fg)]">
            {item.name}
          </span>
          {item.handle ? (
            <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
              @{item.handle}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex items-baseline gap-4">{children}</span>
    </li>
  );
}

function TextAction({
  onClick,
  muted = false,
  children,
}: {
  onClick: () => void;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono text-[10px] uppercase tracking-[0.18em] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-[var(--color-accent)] hover:text-[var(--color-accent)] ${
        muted ? "text-[var(--fg-subtle)]" : "text-[var(--fg-muted)]"
      }`}
    >
      {children}
    </button>
  );
}

function sinceLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
