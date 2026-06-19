"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function CatalogSearch({ initial }: { initial: string }) {
	const router = useRouter();
	const [value, setValue] = useState(initial);
	const [isPending, startTransition] = useTransition();

	const onSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		startTransition(() => {
			const q = value.trim();
			router.push(q ? `/catalog?q=${encodeURIComponent(q)}` : "/catalog");
		});
	};

	return (
		<form
			onSubmit={onSubmit}
			className="flex items-baseline gap-3 border-b border-[var(--color-rule-strong)] py-2"
		>
			<label
				htmlFor="catalog-search"
				className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]"
			>
				Search
			</label>
			<input
				id="catalog-search"
				type="search"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="helmet, badge, M1…"
				disabled={isPending}
				className="flex-1 bg-transparent font-display italic text-[18px] outline-none placeholder:text-[var(--fg-subtle)]"
			/>
			<button
				type="submit"
				disabled={isPending}
				className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] disabled:opacity-50"
			>
				{isPending ? "…" : "Go →"}
			</button>
		</form>
	);
}
