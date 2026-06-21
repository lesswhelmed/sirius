"use client";

import type { OwnerCategory } from "@repo/db";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";

// The catalog's PRIMARY navigation: a structural index of the owner's categories
// (a post has exactly one), rendered as a left rail. Adapted from the v0/Stitch
// "Field Journal" reference to the repo's CSS-var tokens. Self-contained — it
// owns its `?category=<slug>` URL state the same way OwnerFilters owns the rest,
// so the server component only has to hand it the rows.
//
// Like TagFilterBox, it is searchable and caps its own height with an internal
// scroll region: a long taxonomy scrolls WITHIN the box instead of pushing the
// tag filter below it off-screen. "All Work" (the reset) is pinned above the
// scroll area so clearing the category never requires scrolling.
interface Props {
  categories: readonly OwnerCategory[];
  // True post count for the "All Work" entry. Passed in rather than summing
  // category counts, since a post without a category wouldn't be counted there.
  totalCount: number;
  activeCategory?: string;
}

export function CategoryIndex({
  categories,
  totalCount,
  activeCategory,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");

  const select = useCallback(
    (slug: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (!slug || next.get("category") === slug) {
        next.delete("category");
      } else {
        next.set("category", slug);
      }
      // Switching the primary category re-pages from the top.
      next.delete("page");
      start(() => {
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [params, pathname, router],
  );

  const visibleCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? categories.filter((c) => c.displayName.toLowerCase().includes(q))
      : categories;
    // The selected category floats to the top so it stays visible in the scroll
    // region; the rest stay in the order the server handed them (by count).
    return [...filtered].sort((a, b) => {
      const aSel = activeCategory === a.slug;
      const bSel = activeCategory === b.slug;
      if (aSel !== bSel) return aSel ? -1 : 1;
      return 0;
    });
  }, [categories, query, activeCategory]);

  // Only offer the filter input once the list is long enough to warrant it —
  // a handful of categories is faster to scan than to type through.
  const showSearch = categories.length > 8;

  return (
    <nav aria-label="Categories" aria-busy={pending} className="w-full">
      <h2 className="mb-2 flex items-baseline gap-1.5 border-b border-[var(--color-rule-strong)] pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-faint)]">
        <span>Categories</span>
        {activeCategory ? (
          <>
            <span aria-hidden="true" className="text-[var(--color-rule-strong)]">
              ·
            </span>
            <span className="text-[var(--color-accent)]">1 selected</span>
          </>
        ) : null}
      </h2>

      {showSearch ? (
        <input
          type="text"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter categories…"
          aria-label="Filter categories"
          className="mb-1 w-full border-0 border-b border-[var(--color-rule)] bg-transparent px-0 py-2 font-mono text-[11px] tracking-[0.05em] text-[var(--fg)] transition-colors duration-150 placeholder:uppercase placeholder:tracking-[0.1em] placeholder:text-[var(--fg-faint)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      ) : null}

      {/* "All Work" is pinned above the scroll area so the reset control is
          always one click away, regardless of how far the list has scrolled or
          what the filter hides. */}
      <CategoryEntry
        label="All Work"
        count={totalCount}
        selected={!activeCategory}
        onSelect={() => select(null)}
      />

      <div
        className="max-h-[300px] overflow-y-auto [scrollbar-color:var(--color-rule-strong)_transparent] [scrollbar-width:thin]"
        role="group"
        aria-label="Category options"
      >
        {visibleCategories.length === 0 ? (
          <p className="px-1 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--fg-faint)]">
            No categories match
          </p>
        ) : (
          <ul className="flex flex-col">
            {visibleCategories.map((category) => {
              const selected = activeCategory === category.slug;
              return (
                <li key={category.slug}>
                  <CategoryEntry
                    label={category.displayName}
                    count={category.count}
                    selected={selected}
                    onSelect={() => select(category.slug)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}

function CategoryEntry({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`group relative flex w-full items-baseline justify-between gap-3 border-b border-l py-2.5 pl-3 pr-1 text-left transition-transform duration-150 ease-out hover:translate-x-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-ring)] ${
        selected
          ? "border-b-[var(--color-rule)] border-l-[var(--color-accent)]"
          : "border-b-[var(--color-rule)] border-l-transparent"
      }`}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute -left-3 top-1/2 -translate-y-1/2 leading-none text-[var(--color-accent)]"
        >
          ·
        </span>
      ) : null}
      <span
        className={`font-display text-[16px] leading-snug ${
          selected
            ? "italic text-[var(--color-accent)]"
            : "text-[var(--fg)] group-hover:text-[var(--color-accent)]"
        }`}
      >
        {label}
      </span>
      <span
        className={`font-mono text-[11px] tabular-nums ${
          selected ? "text-[var(--color-accent)]" : "text-[var(--fg-faint)]"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
