"use client";

import { useEffect, useRef, useState } from "react";

type SearchResult = {
  id: string;
  name: string;
  handle: string | null;
  state: "self" | "none" | "outgoing" | "incoming" | "friends";
};

// Find a user by exact @handle and send them a request. Debounced lookup against
// /api/app/friends/search; the result row's action reflects the current state.
export function AddFriend() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length === 0) {
      setResult(null);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/app/friends/search?q=${encodeURIComponent(term)}`,
        );
        const data = (await res.json()) as { results: SearchResult[] };
        if (mine === seq.current) {
          setResult(data.results[0] ?? null);
        }
      } catch {
        if (mine === seq.current) setResult(null);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const send = async (handle: string) => {
    setError(null);
    try {
      const res = await fetch("/api/app/friends/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSent(true);
    } catch {
      setError("Couldn’t send the request.");
    }
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Add a friend
        </span>
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSent(false);
          }}
          placeholder="search by @handle"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="mt-1 block w-full max-w-sm border-b border-[var(--color-rule)] bg-transparent pb-1 font-display text-[16px] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--fg-faint)] focus:border-[var(--color-accent)]"
        />
      </label>

      {error ? (
        <p
          role="alert"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
        >
          {error}
        </p>
      ) : null}

      {q.trim().length > 0 ? (
        searching ? (
          <p className="font-display italic text-[14px] text-[var(--fg-subtle)]">
            Searching…
          </p>
        ) : result ? (
          <div className="flex max-w-sm items-baseline justify-between gap-4 py-1">
            <span className="flex items-baseline gap-2">
              <span className="font-display text-[16px] text-[var(--fg)]">
                {result.name}
              </span>
              {result.handle ? (
                <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
                  @{result.handle}
                </span>
              ) : null}
            </span>
            <ResultAction
              result={result}
              sent={sent}
              onAdd={() => result.handle && send(result.handle)}
            />
          </div>
        ) : (
          <p className="font-display italic text-[14px] text-[var(--fg-subtle)]">
            No one found with that handle.
          </p>
        )
      ) : null}
    </div>
  );
}

function ResultAction({
  result,
  sent,
  onAdd,
}: {
  result: SearchResult;
  sent: boolean;
  onAdd: () => void;
}) {
  const tag = (text: string) => (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
      {text}
    </span>
  );
  if (sent || result.state === "outgoing") return tag("Pending");
  if (result.state === "friends") return tag("Friends ✓");
  if (result.state === "incoming") return tag("Wants to connect");
  return (
    <button
      type="button"
      onClick={onAdd}
      className="border border-[var(--color-rule)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
    >
      Add
    </button>
  );
}
