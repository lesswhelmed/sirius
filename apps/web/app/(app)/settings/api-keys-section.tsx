"use client";

import { useCallback, useEffect, useState } from "react";
import { DateDisplay } from "../../../lib/date-display";

// One API key as returned by GET /api/app/api-keys (never the secret itself).
interface ApiKeyRow {
  id: string;
  name: string | null;
  prefix: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  enabled: boolean;
}

// API keys for the MCP corpus server. The plaintext key is shown exactly once,
// right after creation — never persisted client-side, never retrievable again.
export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  // The one-time plaintext secret, held only in memory until dismissed.
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/app/api-keys");
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const data = (await res.json()) as { keys: ApiKeyRow[] };
      setKeys(data.keys);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate() {
    if (creating) return;
    setCreating(true);
    setCreateError(false);
    try {
      const res = await fetch("/api/app/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(name.trim() ? { name: name.trim() } : {}),
      });
      if (!res.ok) throw new Error(`create failed (${res.status})`);
      const data = (await res.json()) as { key: string };
      setFreshKey(data.key);
      setName("");
      await load();
    } catch {
      setCreateError(true);
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: string) {
    if (revoking) return;
    setRevoking(id);
    try {
      const res = await fetch(`/api/app/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`revoke failed (${res.status})`);
      await load();
    } catch {
      // Keep the row; a transient failure shouldn't pretend the key is gone.
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          What these are
        </p>
        <p className="max-w-[60ch] font-body text-[15px] leading-[1.7] text-[var(--fg-muted)]">
          An API key lets an external AI agent read your corpus over the Model
          Context Protocol — searching, browsing your taxonomy, and citing your
          posts as reference. A key grants the agent your own owner-scoped
          access, including private posts, so treat it like a password. Revoke a
          key any time; it stops working immediately.
        </p>
      </div>

      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Create a key
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="API key name"
            placeholder="Name (e.g. Claude Desktop)"
            maxLength={100}
            className="min-w-[240px] border border-[var(--color-rule-emphatic)] bg-transparent px-3 py-2 font-mono text-[12px] text-[var(--fg)] placeholder:text-[var(--fg-faint)] focus:border-[var(--color-accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="border border-[var(--color-rule-emphatic)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create key"}
          </button>
          {createError ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              Couldn’t create — try again.
            </span>
          ) : null}
        </div>

        {freshKey ? (
          <div className="space-y-3 border border-[var(--color-accent)] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
              Copy this now — you won’t see it again
            </p>
            <code className="block break-all font-mono text-[13px] text-[var(--fg)]">
              {freshKey}
            </code>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(freshKey);
                }}
                className="border border-[var(--color-rule-emphatic)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setFreshKey(null)}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)]"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Your keys
        </p>
        {loadError ? (
          <p className="font-display italic text-[15px] text-[var(--color-accent)]">
            Couldn’t load your keys.
          </p>
        ) : keys == null ? (
          <p className="font-display italic text-[15px] text-[var(--fg-subtle)]">
            Loading…
          </p>
        ) : keys.length === 0 ? (
          <p className="font-display italic text-[15px] text-[var(--fg-subtle)]">
            No API keys yet.
          </p>
        ) : (
          <ul className="space-y-0">
            {keys.map((k) => (
              <li
                key={k.id}
                className="hairline-b flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
              >
                <span className="font-display italic text-[15px] text-[var(--fg)]">
                  {k.name ?? "Untitled key"}
                  {k.prefix ? (
                    <span className="ml-2 font-mono text-[11px] not-italic text-[var(--fg-subtle)]">
                      {k.prefix}…
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
                  {k.lastUsedAt ? (
                    <>
                      Last used{" "}
                      <DateDisplay value={k.lastUsedAt} variant="date-short" />
                    </>
                  ) : (
                    <>
                      Created{" "}
                      <DateDisplay value={k.createdAt} variant="date-short" />
                    </>
                  )}
                  {k.expiresAt ? (
                    <>
                      {" · expires "}
                      <DateDisplay value={k.expiresAt} variant="date-short" />
                    </>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => onRevoke(k.id)}
                  disabled={revoking === k.id}
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
                >
                  {revoking === k.id ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
