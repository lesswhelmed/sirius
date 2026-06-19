import { listProjectTitles, listSubmissions } from "@repo/db";
import { requireSession } from "../../../lib/session";
import { Live } from "./live";

export default async function QueuePage() {
	const session = await requireSession("/queue");
	const [initial, projectTitles] = await Promise.all([
		listSubmissions(session.user.id, { limit: 50 }),
		listProjectTitles(session.user.id),
	]);

	return (
		<section>
			<div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
				<header>
					<p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
						Section III — The Wire
					</p>
					<h1 className="mt-1 font-display italic text-[40px] leading-[0.95] tracking-[-0.01em] sm:text-[48px]">
						In Flight<span className="text-[var(--color-accent)]">.</span>
					</h1>
					<p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
						Submissions on their way through the press — pending, processing,
						filed, or spiked. Refreshes every three seconds.
					</p>
				</header>

				<div className="flex items-baseline gap-2 text-[var(--fg-subtle)]">
					<span
						aria-hidden="true"
						className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]"
					/>
					<span className="font-mono text-[10px] uppercase tracking-[0.22em]">
						Live · polling 3s
					</span>
				</div>
			</div>

			<div className="hairline-t mt-7 pt-5">
				<Live initialItems={initial.items} projectTitles={projectTitles} />
			</div>
		</section>
	);
}
