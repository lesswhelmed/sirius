"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{2,29}$/;

export function SetupHandleForm({ suggested }: { suggested: string }) {
  const [handle, setHandle] = useState(suggested);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const trimmed = handle.trim().toLowerCase();
    if (!HANDLE_REGEX.test(trimmed)) {
      setError("Use 3–30 lowercase letters, digits, or hyphens.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/app/me/handle", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: trimmed }),
      });
      if (res.status === 409) {
        setError("That handle is taken — try another.");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.replace("/ingest");
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Handle
        </span>
        <div className="flex items-baseline gap-2 border-b border-[var(--color-rule-strong)] py-2">
          <span className="font-mono text-[16px] text-[var(--fg-subtle)]">
            @
          </span>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={isPending}
            className="flex-1 bg-transparent font-mono text-[18px] outline-none placeholder:text-[var(--fg-subtle)]"
            placeholder="quartermaster"
          />
        </div>
        {error ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-accent)]">
            {error}
          </span>
        ) : null}
      </label>

      <button
        type="submit"
        disabled={isPending || handle.trim().length === 0}
        className="h-12 border border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)] transition-colors disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-[var(--color-accent)] enabled:hover:border-[var(--color-accent)]"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.32em]">
          {isPending ? "Saving…" : "Save handle →"}
        </span>
      </button>
    </form>
  );
}
