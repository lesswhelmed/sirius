"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

export interface AspirationRow {
  id: string;
  title: string;
  description: string | null;
  projectCount: number;
}

// Create / list / delete aspirations (top-level goals). Each row links to its
// detail page where focus areas are managed. Optimistic island pattern.
export function AspirationsBoard({
  initialAspirations,
}: {
  initialAspirations: AspirationRow[];
}) {
  const [aspirations, setAspirations] =
    useState<AspirationRow[]>(initialAspirations);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const create = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/app/aspirations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: trimmed,
            description: description.trim() || undefined,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          aspiration: { id: string; title: string; description: string | null };
        };
        setAspirations((prev) => [
          { ...data.aspiration, projectCount: 0 },
          ...prev,
        ]);
        setTitle("");
        setDescription("");
      } catch {
        setError("Could not create aspiration.");
      }
    });
  };

  const remove = (id: string) => {
    const previous = aspirations;
    setAspirations((prev) => prev.filter((a) => a.id !== id));
    start(async () => {
      try {
        const res = await fetch(`/api/app/aspirations/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        setAspirations(previous);
      }
    });
  };

  return (
    <div className="space-y-8">
      <div className="hairline-b space-y-3 pb-7">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="New aspiration title"
          placeholder="New aspiration — e.g. Become a thought leader"
          className="w-full border-b border-[var(--color-rule)] bg-transparent pb-1 font-display italic text-[22px] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--fg-faint)] focus:border-[var(--color-accent)]"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Aspiration description (optional)"
          placeholder="What does this goal mean to you? (optional)"
          rows={2}
          className="w-full resize-none bg-transparent font-body text-[15px] leading-relaxed text-[var(--fg-muted)] outline-none placeholder:text-[var(--fg-faint)]"
        />
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={create}
            disabled={pending || title.trim() === ""}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] transition-opacity hover:opacity-70 disabled:opacity-40"
          >
            Add aspiration →
          </button>
        </div>
        {error ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
            {error}
          </p>
        ) : null}
      </div>

      {aspirations.length === 0 ? (
        <p className="font-display italic text-[17px] text-[var(--fg-subtle)]">
          No aspirations yet. Name the big things you&rsquo;re working toward.
        </p>
      ) : (
        <ul className="space-y-0">
          {aspirations.map((a) => (
            <li
              key={a.id}
              className="hairline-b flex items-baseline justify-between gap-4 py-4"
            >
              <div className="min-w-0">
                <Link
                  href={`/aspirations/${a.id}`}
                  className="font-display italic text-[22px] text-[var(--fg)] transition-colors hover:text-[var(--color-accent)]"
                >
                  {a.title}
                </Link>
                {a.description ? (
                  <p className="mt-1 truncate font-body text-[14px] text-[var(--fg-muted)]">
                    {a.description}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-baseline gap-4 font-mono text-[10px] uppercase tracking-[0.22em]">
                <span className="text-[var(--fg-subtle)] nums-lining">
                  {a.projectCount} focus
                </span>
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  disabled={pending}
                  className="text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
