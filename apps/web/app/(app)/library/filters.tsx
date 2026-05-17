"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { PostStatus, PostType } from "@repo/db";

interface Props {
  types: readonly PostType[];
  statuses: readonly PostStatus[];
  activeType?: PostType;
  activeStatus?: PostStatus;
  q: string;
}

export function Filters({ types, statuses, activeType, activeStatus, q }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const push = useCallback(
    (next: URLSearchParams) => {
      start(() => {
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [pathname, router]
  );

  const toggle = (key: "type" | "status", value: string) => {
    const next = new URLSearchParams(params.toString());
    if (next.get(key) === value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    push(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <div className="flex items-center gap-1">
        {types.map((t) => {
          const active = activeType === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggle("type", t)}
              className={`rounded-[var(--radius-chip)] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                active
                  ? "border-[color:var(--color-accent-soft)] bg-[color:var(--color-accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>
      <span className="text-[var(--fg-subtle)]">·</span>
      <div className="flex items-center gap-1">
        {statuses.map((s) => {
          const active = activeStatus === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle("status", s)}
              className={`rounded-[var(--radius-chip)] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                active
                  ? "border-[color:var(--color-accent-soft)] bg-[color:var(--color-accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>
      <form
        action={pathname}
        className="ml-2 flex items-center"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params.toString());
          const value = new FormData(e.currentTarget).get("q");
          if (typeof value === "string" && value.trim()) {
            next.set("q", value.trim());
          } else {
            next.delete("q");
          }
          push(next);
        }}
      >
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search title…"
          className="h-8 w-44 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 font-mono text-[12px] text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-ring)]"
        />
      </form>
    </div>
  );
}
