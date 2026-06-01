"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { PostStatus, PostType } from "@repo/db";

interface Props {
  types: readonly PostType[];
  statuses: readonly PostStatus[];
  typeLabels: Record<PostType, string>;
  activeType?: PostType;
  activeStatus?: PostStatus;
  q: string;
}

export function OwnerFilters({
  types,
  statuses,
  typeLabels,
  activeType,
  activeStatus,
  q,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const push = useCallback(
    (next: URLSearchParams) => {
      start(() => {
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
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
    // Any filter change invalidates the current page offset.
    next.delete("page");
    push(next);
  };

  return (
    <div
      className="flex flex-wrap items-baseline gap-x-6 gap-y-3 font-mono text-[10px] uppercase tracking-[0.18em]"
      aria-busy={pending}
    >
      <span className="text-[var(--fg-subtle)]">Filter by</span>

      <FilterGroup label="kind">
        {types.map((t) => (
          <FilterChip
            key={t}
            active={activeType === t}
            onClick={() => toggle("type", t)}
            label={typeLabels[t]}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="state">
        {statuses.map((s) => (
          <FilterChip
            key={s}
            active={activeStatus === s}
            onClick={() => toggle("status", s)}
            label={s.toLowerCase()}
          />
        ))}
      </FilterGroup>

      <form
        action={pathname}
        className="flex items-baseline gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params.toString());
          const value = new FormData(e.currentTarget).get("q");
          if (typeof value === "string" && value.trim()) {
            next.set("q", value.trim());
          } else {
            next.delete("q");
          }
          // New search resets pagination to the first page.
          next.delete("page");
          push(next);
        }}
      >
        <span className="text-[var(--fg-subtle)]">Search</span>
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="title, excerpt, tag…"
          className="w-52 border-b border-[var(--color-rule-strong)] bg-transparent px-1 pb-1 font-body text-[15px] italic tracking-normal text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </form>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[var(--fg-subtle)]">{label}</span>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {children}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative pb-0.5 transition-colors ${
        active
          ? "text-[var(--color-accent)]"
          : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
      }`}
    >
      {label}
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-0 h-px transition-colors ${
          active ? "bg-[var(--color-accent)]" : "bg-transparent"
        }`}
      />
    </button>
  );
}
