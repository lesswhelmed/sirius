import { getProject, listProjectPosts } from "@repo/db";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DateDisplay } from "../../../../lib/date-display";
import { requireSession } from "../../../../lib/session";

const TYPE_LABEL: Record<string, string> = {
	CONCRETE: "Concrete",
	BLOG: "Dispatch",
	FINDING: "Finding",
	SIGHT: "Sight",
	SOCIAL: "Social",
};

export default async function ProjectDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const session = await requireSession("/projects");
	const { id } = await params;
	const project = await getProject(session.user.id, id);
	if (!project) {
		notFound();
	}
	const postPage = await listProjectPosts(session.user.id, id, { limit: 100 });

	return (
		<section className="mx-auto max-w-[920px]">
			<Link
				href="/projects"
				className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
			>
				<span aria-hidden="true">←</span>
				Return to Focus
			</Link>

			<header className="mt-8">
				<div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-y border-[var(--color-rule-emphatic)] py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)]">
					<span className="text-[var(--color-accent)]">Focus Area</span>
					<span aria-hidden="true" className="text-[var(--fg-faint)]">
						·
					</span>
					<span>{project.status}</span>
					<span aria-hidden="true" className="text-[var(--fg-faint)]">
						·
					</span>
					<span className="nums-lining">{project._count.posts} filed</span>
				</div>

				<h1 className="mt-6 font-display text-[44px] leading-[0.98] tracking-[-0.015em] text-balance sm:text-[56px]">
					{project.title}
				</h1>

				{project.description ? (
					<p className="mt-6 max-w-[52ch] font-display italic text-[20px] leading-[1.35] text-[var(--fg-muted)] text-pretty">
						{project.description}
					</p>
				) : null}
			</header>

			<div className="mt-12">
				<p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
					Filed under this focus area
				</p>
				{postPage.items.length === 0 ? (
					<p className="mt-5 font-display italic text-[17px] text-[var(--fg-subtle)]">
						Nothing filed here yet. Open any post and assign it via the
						colophon.
					</p>
				) : (
					<ul className="mt-5 space-y-0">
						{postPage.items.map((post) => (
							<li
								key={post.id}
								className="hairline-b flex items-baseline justify-between gap-4 py-4"
							>
								<Link
									href={`/posts/${post.slug}`}
									className="min-w-0 font-display italic text-[20px] text-[var(--fg)] transition-colors hover:text-[var(--color-accent)]"
								>
									{post.title}
								</Link>
								<div className="flex shrink-0 items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
									<span className="text-[var(--color-accent)]">
										{TYPE_LABEL[post.type] ?? post.type}
									</span>
									<DateDisplay
										value={post.originalDate ?? post.createdAt}
										variant="date-long"
										className="nums-lining"
									/>
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
