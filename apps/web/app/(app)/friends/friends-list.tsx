"use client";

import { useState, useTransition } from "react";

export interface FriendItem {
  id: string;
  name: string;
  handle: string | null;
}

export interface RequestItem extends FriendItem {
  direction: "incoming" | "outgoing";
}

// The interactive friends + requests lists. Optimistic mutations with
// revert-on-failure, mirroring assign-to-project's pattern. The server page
// passes the initial data; this owns the live state thereafter.
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
  const [, start] = useTransition();

  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");

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
    setFriends((cur) => [{ id: r.id, name: r.name, handle: r.handle }, ...cur]);
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

      <Section label="Requests" empty="No pending requests." count={incoming.length}>
        {incoming.map((r) => (
          <Row key={r.id} item={r}>
            <TextAction onClick={() => accept(r)}>Accept</TextAction>
            <TextAction onClick={() => decline(r)} muted>
              Decline
            </TextAction>
          </Row>
        ))}
      </Section>

      <Section label="Pending" empty="No outgoing requests." count={outgoing.length}>
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

      <Section label="Friends" empty="No friends yet." count={friends.length}>
        {friends.map((f) => (
          <Row key={f.id} item={f}>
            <TextAction onClick={() => remove(f)} muted>
              Remove
            </TextAction>
          </Row>
        ))}
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

function Row({
  item,
  children,
}: {
  item: FriendItem;
  children: React.ReactNode;
}) {
  return (
    <li className="hairline-b flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <span className="flex items-baseline gap-2">
        <span className="font-display text-[18px] text-[var(--fg)]">
          {item.name}
        </span>
        {item.handle ? (
          <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
            @{item.handle}
          </span>
        ) : null}
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
