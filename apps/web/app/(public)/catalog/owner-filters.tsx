"use client";

import type { OwnerTag, PostSort, PostStatus, PostType } from "@repo/db";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

export interface SortOption {
	value: PostSort;
	label: string;
}

interface Props {
	types: readonly PostType[];
	statuses: readonly PostStatus[];
	typeLabels: Record<PostType, string>;
	sorts: readonly SortOption[];
	defaultSort: PostSort;
	activeType?: PostType;
	activeStatus?: PostStatus;
	activeSort: PostSort;
	q: string;
	tags: readonly OwnerTag[];
	// Active tag SLUGS (multi-select). The URL carries them comma-joined as `tag`.
	activeTags: readonly string[];
	// The active primary category slug + its human label, for the summary line.
	activeCategory?: string;
	activeCategoryLabel?: string;
}

export function OwnerFilters({
	types,
	statuses,
	typeLabels,
	sorts,
	defaultSort,
	activeType,
	activeStatus,
	activeSort,
	q,
	tags,
	activeTags,
	activeCategory,
	activeCategoryLabel,
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
		[pathname, router],
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

	const selectSort = (value: PostSort) => {
		const next = new URLSearchParams(params.toString());
		// Keep the default out of the URL; changing sort re-pages from the top.
		if (value === defaultSort) {
			next.delete("sort");
		} else {
			next.set("sort", value);
		}
		next.delete("page");
		push(next);
	};

	// CLEAR ALL drops every filter dimension (kind, state, category, tags, search)
	// but preserves the sort order, which reads as a view preference, not a filter.
	const clearAll = () => {
		const next = new URLSearchParams(params.toString());
		for (const key of ["type", "status", "category", "tag", "q", "page"]) {
			next.delete(key);
		}
		push(next);
	};

	// Human labels for the active tags (URL carries slugs), in selection order.
	const activeTagNames = activeTags.map(
		(slug) => tags.find((t) => t.slug === slug)?.name ?? slug,
	);
	const hasSummary = Boolean(activeCategory) || activeTags.length > 0;

	return (
		<div className="space-y-5" aria-busy={pending}>
			<div className="flex flex-wrap items-baseline gap-x-6 gap-y-3 font-mono text-[10px] uppercase tracking-[0.18em]">
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

				<FilterGroup label="sort">
					{sorts.map((s) => (
						<FilterChip
							key={s.value}
							active={activeSort === s.value}
							onClick={() => selectSort(s.value)}
							label={s.label}
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

			{/* Active-filter summary + CLEAR ALL. */}
			{hasSummary ? (
				<div className="flex items-center justify-between gap-4 bg-[var(--color-paper-sunken)] px-3 py-2.5">
					<p className="font-mono text-[11px] text-[var(--fg-muted)]">
						Showing{" "}
						{activeCategoryLabel ? (
							<span className="font-display text-[14px] italic text-[var(--fg)]">
								{activeCategoryLabel}
							</span>
						) : null}
						{activeTagNames.map((name, i) => (
							<span key={activeTags[i] ?? name}>
								{activeCategoryLabel || i > 0 ? (
									<span className="text-[var(--fg-faint)]"> · </span>
								) : null}
								<span className="text-[var(--color-accent)]">{name}</span>
							</span>
						))}
					</p>
					<button
						type="button"
						onClick={clearAll}
						className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)] hover:font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-ring)]"
					>
						Clear all <span aria-hidden="true">✕</span>
					</button>
				</div>
			) : null}
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
