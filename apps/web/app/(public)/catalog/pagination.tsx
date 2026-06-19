"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

interface Props {
	page: number;
	totalPages: number;
}

export function Pagination({ page, totalPages }: Props) {
	const router = useRouter();
	const pathname = usePathname();
	const params = useSearchParams();
	const [pending, start] = useTransition();

	const goTo = useCallback(
		(target: number) => {
			const next = new URLSearchParams(params.toString());
			if (target <= 1) {
				next.delete("page");
			} else {
				next.set("page", String(target));
			}
			start(() => {
				const qs = next.toString();
				router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
			});
		},
		[params, pathname, router],
	);

	const hasPrev = page > 1;
	const hasNext = page < totalPages;

	return (
		<nav
			aria-label="Pagination"
			aria-busy={pending}
			className="flex items-baseline justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]"
		>
			<PageStep
				label="Previous"
				glyph="←"
				side="left"
				disabled={!hasPrev}
				onClick={() => goTo(page - 1)}
			/>

			<span className="nums-lining">
				Page <span className="text-[var(--color-accent)]">{page}</span> of{" "}
				{totalPages}
			</span>

			<PageStep
				label="Next"
				glyph="→"
				side="right"
				disabled={!hasNext}
				onClick={() => goTo(page + 1)}
			/>
		</nav>
	);
}

function PageStep({
	label,
	glyph,
	side,
	disabled,
	onClick,
}: {
	label: string;
	glyph: string;
	side: "left" | "right";
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex items-baseline gap-2 transition-colors ${
				disabled
					? "cursor-default text-[var(--fg-faint)]"
					: "text-[var(--fg-muted)] hover:text-[var(--color-accent)]"
			}`}
		>
			{side === "left" ? <span aria-hidden="true">{glyph}</span> : null}
			{label}
			{side === "right" ? <span aria-hidden="true">{glyph}</span> : null}
		</button>
	);
}
