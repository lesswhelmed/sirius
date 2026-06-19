"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Enqueues a data-archive build. The worker assembles the zip and emails a
// time-limited download link; the request also appears in the history table
// (refreshed here on success).
export function RequestArchiveButton() {
	const router = useRouter();
	const [state, setState] = useState<"idle" | "busy" | "queued" | "error">(
		"idle",
	);

	async function onClick() {
		if (state === "busy") return;
		setState("busy");
		try {
			const res = await fetch("/api/app/archive", { method: "POST" });
			if (!res.ok) {
				throw new Error(`request failed (${res.status})`);
			}
			setState("queued");
			router.refresh();
		} catch {
			setState("error");
		}
	}

	return (
		<div className="flex flex-wrap items-baseline gap-3">
			<button
				type="button"
				onClick={onClick}
				disabled={state === "busy"}
				className="border border-[var(--color-rule-emphatic)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
			>
				{state === "busy" ? "Requesting…" : "Request my data archive"}
			</button>
			{state === "queued" ? (
				<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
					Queued — we’ll email you a link when it’s ready.
				</span>
			) : null}
			{state === "error" ? (
				<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
					Something went wrong — try again.
				</span>
			) : null}
		</div>
	);
}
