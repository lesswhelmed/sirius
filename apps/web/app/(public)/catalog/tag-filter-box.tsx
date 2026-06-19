"use client";

import type { OwnerTag } from "@repo/db";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";

// The secondary refine layer: a compact, fixed-height, searchable+scrollable tag
// box that lives in the left rail BELOW the category index. Replaces the wide
// tag cloud, which was overwhelming with dozens of tags. Adapted from the
// v0/Stitch "Field Journal" draft to the repo tokens. Self-contained — it owns
// its `?tag=a,b` (comma-joined slugs) URL state, like CategoryIndex/OwnerFilters.
interface Props {
	tags: readonly OwnerTag[];
	// Active tag SLUGS, parsed from the URL by the server component.
	activeTags: readonly string[];
}

export function TagFilterBox({ tags, activeTags }: Props) {
	const router = useRouter();
	const pathname = usePathname();
	const params = useSearchParams();
	const [pending, start] = useTransition();
	const [query, setQuery] = useState("");

	const toggle = useCallback(
		(slug: string) => {
			const next = new URLSearchParams(params.toString());
			const current = (next.get("tag") ?? "")
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			const updated = current.includes(slug)
				? current.filter((s) => s !== slug)
				: [...current, slug];
			if (updated.length > 0) {
				next.set("tag", updated.join(","));
			} else {
				next.delete("tag");
			}
			next.delete("page");
			start(() => {
				const qs = next.toString();
				router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
			});
		},
		[params, pathname, router],
	);

	const visibleTags = useMemo(() => {
		const q = query.trim().toLowerCase();
		const filtered = q
			? tags.filter((t) => t.name.toLowerCase().includes(q))
			: tags;
		// Selected tags float to the top so they stay visible in the scroll region.
		return [...filtered].sort((a, b) => {
			const aSel = activeTags.includes(a.slug);
			const bSel = activeTags.includes(b.slug);
			if (aSel !== bSel) return aSel ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	}, [tags, query, activeTags]);

	const selectedCount = activeTags.length;

	return (
		<section aria-label="Filter by tag" aria-busy={pending} className="w-full">
			<h2 className="mb-2 flex items-baseline gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-faint)]">
				<span>Tags</span>
				{selectedCount > 0 ? (
					<>
						<span
							aria-hidden="true"
							className="text-[var(--color-rule-strong)]"
						>
							·
						</span>
						<span className="tabular-nums text-[var(--color-accent)]">
							{selectedCount} selected
						</span>
					</>
				) : null}
			</h2>

			<input
				type="text"
				inputMode="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Filter tags…"
				aria-label="Filter tags"
				className="mb-1 w-full border-0 border-b border-[var(--color-rule)] bg-transparent px-0 py-2 font-mono text-[11px] tracking-[0.05em] text-[var(--fg)] transition-colors duration-150 placeholder:uppercase placeholder:tracking-[0.1em] placeholder:text-[var(--fg-faint)] focus:border-[var(--color-accent)] focus:outline-none"
			/>

			<div
				className="max-h-[300px] overflow-y-auto [scrollbar-color:var(--color-rule-strong)_transparent] [scrollbar-width:thin]"
				role="group"
				aria-label="Tag options"
			>
				{visibleTags.length === 0 ? (
					<p className="px-1 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--fg-faint)]">
						No tags match
					</p>
				) : (
					<ul className="flex flex-col">
						{visibleTags.map((tag) => {
							const selected = activeTags.includes(tag.slug);
							return (
								<li key={tag.slug}>
									<button
										type="button"
										aria-pressed={selected}
										onClick={() => toggle(tag.slug)}
										className={`group flex w-full items-baseline justify-between gap-2 border-b border-l py-1.5 pl-2 pr-2 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-ring)] ${
											selected
												? "border-b-[var(--color-rule)] border-l-[var(--color-accent)] bg-[var(--color-accent-soft)]"
												: "border-b-[var(--color-rule)] border-l-transparent hover:bg-[var(--color-paper-sunken)]"
										}`}
									>
										<span className="flex min-w-0 items-baseline gap-1.5">
											<span
												aria-hidden="true"
												className={`w-2 shrink-0 text-[10px] leading-none ${
													selected
														? "text-[var(--color-accent)]"
														: "text-transparent"
												}`}
											>
												✓
											</span>
											<span
												className={`truncate font-mono text-[10px] uppercase tracking-[0.15em] ${
													selected
														? "text-[var(--color-accent)]"
														: "text-[var(--fg-muted)] group-hover:text-[var(--color-accent)]"
												}`}
											>
												{tag.name}
											</span>
										</span>
										<span
											className={`shrink-0 font-mono text-[10px] tabular-nums ${
												selected
													? "text-[var(--color-accent)]"
													: "text-[var(--fg-faint)]"
											}`}
										>
											{tag.count}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</section>
	);
}
