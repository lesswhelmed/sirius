"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { OwnerCategory } from "@repo/db";

// The catalog's PRIMARY navigation: a structural index of the owner's categories
// (a post has exactly one), rendered as a left rail. Adapted from the v0/Stitch
// "Field Journal" reference to the repo's CSS-var tokens. Self-contained — it
// owns its `?category=<slug>` URL state the same way OwnerFilters owns the rest,
// so the server component only has to hand it the rows.
interface Props {
  categories: readonly OwnerCategory[];
  // True post count for the "All Work" entry. Passed in rather than summing
  // category counts, since a post without a category wouldn't be counted there.
  totalCount: number;
  activeCategory?: string;
}

export function CategoryIndex({ categories, totalCount, activeCategory }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

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
    [params, pathname, router]
  );

  return (
    <nav aria-label="Categories" aria-busy={pending} className="w-full">
      <h2 className="border-b border-[var(--color-rule-strong)] pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-faint)]">
        Categories
      </h2>

      <ul className="mt-1 flex flex-col">
        <li>
          <CategoryEntry
            label="All Work"
            count={totalCount}
            selected={!activeCategory}
            onSelect={() => select(null)}
          />
        </li>
        {categories.map((category) => {
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
