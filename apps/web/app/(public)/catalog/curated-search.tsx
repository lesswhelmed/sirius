"use client";

import type { SearchHit, SearchPage } from "@repo/db";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

// Curated search over the viewer's corpus: one debounced field whose results are
// the RRF-fused blend of full-text (exact) + embedding (similar) hits from
// /api/app/search. Adapted from a v0-generated component into the catalog's
// editorial token system (accent/rule/fg + display/mono fonts). The visual
// language — hairline-ruled rows, serif-italic titles, solid-accent EXACT vs.
// outlined SIMILAR badges — mirrors CatalogCard so search feels native to the
// catalog rather than bolted on.

const DEBOUNCE_MS = 250;

function ExactBadge() {
  return (
    <span
      title="Matched by keyword / full-text search"
      className="inline-flex items-center gap-1 bg-[var(--color-accent)] px-1.5 py-0.5 font-mono text-[8px] uppercase leading-none tracking-[0.15em] text-[var(--color-paper)] select-none"
    >
      <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-current" />
      exact
    </span>
  );
}

function SimilarBadge() {
  return (
    <span
      title="Matched by semantic similarity"
      className="inline-flex items-center gap-1 border border-[var(--color-accent)] px-1.5 py-0.5 font-mono text-[8px] uppercase leading-none tracking-[0.15em] text-[var(--color-accent)] select-none"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1 w-1 rounded-full border border-current"
      />
      similar
    </span>
  );
}

function SkeletonRow({ index }: { index: number }) {
  const widths = ["w-3/4", "w-2/3", "w-5/6"];
  return (
    <li
      aria-hidden="true"
      className="animate-pulse border-b border-[var(--color-rule)] py-5 last:border-b-0"
    >
      <div className="mb-3 h-2 w-12 bg-[var(--color-rule-strong)]" />
      <div className={`mb-2 h-5 ${widths[index % widths.length]} bg-[var(--color-rule-strong)]`} />
      <div className="mb-1.5 h-3 w-full bg-[var(--color-rule)] opacity-70" />
      <div className="mb-3 h-3 w-4/5 bg-[var(--color-rule)] opacity-70" />
      <div className="flex gap-2">
        <div className="h-[18px] w-14 bg-[var(--color-rule)] opacity-60" />
        <div className="h-[18px] w-16 bg-[var(--color-rule)] opacity-50" />
      </div>
    </li>
  );
}

function ResultRow({ hit }: { hit: SearchHit }) {
  const category = hit.categories[0];
  const tags = hit.tags.slice(0, 4);
  return (
    <li className="group border-b border-[var(--color-rule)] last:border-b-0">
      <Link
        href={`/posts/${hit.slug}`}
        aria-label={`${hit.type}: ${hit.title}`}
        className="block py-5 transition-colors duration-150 hover:bg-[var(--color-paper-raised)]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-ring)]"
      >
        <div className="mb-1.5 flex items-center justify-between gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
            {hit.type.toLowerCase()}
          </span>
          <span className="flex items-center gap-1.5" aria-label="Match reasons">
            {hit.matchReasons.includes("exact") ? <ExactBadge /> : null}
            {hit.matchReasons.includes("similar") ? <SimilarBadge /> : null}
          </span>
        </div>

        <h3 className="mb-1.5 font-display text-[22px] leading-tight tracking-[-0.005em] text-balance text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)] sm:text-[24px]">
          {hit.title}
        </h3>

        {hit.snippet ? (
          <p className="mb-3 line-clamp-2 font-body text-[14px] leading-relaxed text-[var(--fg-muted)]">
            {hit.snippet}
          </p>
        ) : null}

        {category || tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {category ? (
              <span className="inline-block border border-[var(--color-rule)] px-2.5 py-0.5 font-display text-[13px] italic text-[var(--fg)]">
                {category.name}
              </span>
            ) : null}
            {tags.length > 0 ? (
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {tags.map((t) => (
                  <span
                    key={t.slug}
                    className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--fg-subtle)]"
                  >
                    #{t.name}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
      </Link>
    </li>
  );
}

export function CuratedSearch({ scope = "all" }: { scope?: "all" | "mine" }) {
  const [value, setValue] = useState("");
  const [items, setItems] = useState<SearchHit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const listId = useId();

  // Debounce + abort: one in-flight request at a time; a new keystroke cancels
  // the previous fetch so results never arrive out of order.
  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setItems([]);
      setIsLoading(false);
      setPartial(false);
      setError(false);
      return;
    }
    setIsLoading(true);
    setError(false);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/app/search?q=${encodeURIComponent(q)}&scope=${scope}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`search failed: ${res.status}`);
        const page = (await res.json()) as SearchPage;
        setItems(page.items);
        setPartial(page.partial);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(true);
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value, scope]);

  const hasQuery = value.trim().length > 0;
  const showEmpty = hasQuery && !isLoading && !error && items.length === 0;
  const showList = hasQuery && !isLoading && items.length > 0;

  return (
    <div className="w-full">
      {/* Search field, bracketed by ink rules. */}
      <div className="relative">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-[var(--color-rule-emphatic)]" />
        <label htmlFor={inputId} className="sr-only">
          Search your corpus
        </label>
        <div className="flex items-center gap-3 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Search
          </span>
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            role="searchbox"
            aria-controls={listId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search your corpus…"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent font-display text-[18px] italic text-[var(--fg)] caret-[var(--color-accent)] outline-none placeholder:text-[var(--fg-subtle)]"
          />
          {value.length > 0 ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setValue("");
                inputRef.current?.focus();
              }}
              className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
            >
              Clear ✕
            </button>
          ) : null}
        </div>
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-[var(--color-rule-emphatic)]" />
      </div>

      {/* Status bar: result count + degraded-semantic note. */}
      {hasQuery ? (
        <div
          aria-live="polite"
          aria-atomic="true"
          className="flex min-h-[1.5rem] items-center justify-between pt-2.5"
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
            {isLoading
              ? "Searching…"
              : error
                ? "Search failed"
                : `${items.length} result${items.length === 1 ? "" : "s"}`}
          </span>
          {partial && !isLoading ? (
            <span
              role="note"
              aria-label="Semantic similarity search is temporarily unavailable"
              className="border border-dashed border-[var(--color-rule-strong)] px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-[var(--fg-subtle)]"
            >
              Similar matches unavailable
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Results. */}
      <div className="mt-1" role="region" aria-label="Search results">
        {isLoading ? (
          <ul id={listId} aria-label="Loading results" className="mt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} index={i} />
            ))}
          </ul>
        ) : null}

        {showEmpty ? (
          <div role="status" className="flex flex-col items-center gap-3 py-12 text-center">
            <span aria-hidden="true" className="block h-px w-8 bg-[var(--color-rule-strong)]" />
            <p className="font-display text-[20px] italic text-[var(--fg-muted)]">
              Nothing matches
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--fg-subtle)]">
              for “{value.trim()}”
            </p>
          </div>
        ) : null}

        {showList ? (
          <>
            <div aria-hidden="true" className="mt-1 h-px bg-[var(--color-rule)]" />
            <ul id={listId} aria-label={`${items.length} search results`}>
              {items.map((hit) => (
                <ResultRow key={hit.slug} hit={hit} />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
