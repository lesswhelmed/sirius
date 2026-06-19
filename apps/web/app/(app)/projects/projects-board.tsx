"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

export interface ProjectRow {
	id: string;
	title: string;
	description: string | null;
	status: string;
	aspirationId: string | null;
	postCount: number;
	autoCreated: boolean;
}

export interface AspirationOption {
	id: string;
	title: string;
}

const AUTO_DESCRIPTION_PREFIX = "Auto-created from captured material";

// The worker's boilerplate description carries the matched analysis categories
// ("… Related analysis: a, b, c."). Surface those as chips instead of printing
// the same sentence on every auto-created row; human-written descriptions
// render as-is.
function autoChips(description: string | null): string[] | null {
	if (!description?.startsWith(AUTO_DESCRIPTION_PREFIX)) {
		return null;
	}
	const match = description.match(/Related analysis: (.+)\.\s*$/);
	return match
		? match[1]!
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: [];
}

interface Group {
	aspirationId: string | null;
	title: string;
	projects: ProjectRow[];
	filed: number;
}

// Aspiration sections sorted by activity (filed posts, then title), standalone
// focus areas last. Within a group: active before archived, busiest first.
function groupByAspiration(
	projects: ProjectRow[],
	aspirations: AspirationOption[],
): Group[] {
	const titleById = new Map(aspirations.map((a) => [a.id, a.title]));
	const byAspiration = new Map<string | null, ProjectRow[]>();
	for (const p of projects) {
		const key =
			p.aspirationId != null && titleById.has(p.aspirationId)
				? p.aspirationId
				: null;
		const group = byAspiration.get(key) ?? [];
		group.push(p);
		byAspiration.set(key, group);
	}
	const groups: Group[] = [...byAspiration.entries()].map(([id, rows]) => ({
		aspirationId: id,
		title: id == null ? "Standalone" : (titleById.get(id) ?? "Standalone"),
		projects: rows.sort(
			(a, b) =>
				Number(a.status === "archived") - Number(b.status === "archived") ||
				b.postCount - a.postCount ||
				a.title.localeCompare(b.title),
		),
		filed: rows.reduce((sum, p) => sum + p.postCount, 0),
	}));
	return groups.sort((a, b) => {
		if ((a.aspirationId == null) !== (b.aspirationId == null)) {
			return a.aspirationId == null ? 1 : -1;
		}
		return b.filed - a.filed || a.title.localeCompare(b.title);
	});
}

// Create / list / archive / merge / delete projects, grouped by aspiration.
// Reused by the flat /projects page (with an aspiration picker) and the
// aspiration detail page (with a preset aspirationId, picker hidden, flat
// list). Mirrors the optimistic island pattern.
export function ProjectsBoard({
	initialProjects,
	aspirations = [],
	presetAspirationId = null,
}: {
	initialProjects: ProjectRow[];
	aspirations?: AspirationOption[];
	presetAspirationId?: string | null;
}) {
	const [projects, setProjects] = useState<ProjectRow[]>(initialProjects);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [aspirationId, setAspirationId] = useState<string | null>(
		presetAspirationId,
	);
	const [mergeFromId, setMergeFromId] = useState<string | null>(null);
	const [mergeToId, setMergeToId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();

	const create = () => {
		const trimmed = title.trim();
		if (!trimmed) return;
		setError(null);
		start(async () => {
			try {
				const res = await fetch("/api/app/projects", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						title: trimmed,
						description: description.trim() || undefined,
						aspirationId: presetAspirationId ?? aspirationId,
					}),
				});
				if (!res.ok) throw new Error(String(res.status));
				const data = (await res.json()) as {
					project: Omit<ProjectRow, "postCount" | "autoCreated">;
				};
				setProjects((prev) => [
					{ ...data.project, postCount: 0, autoCreated: false },
					...prev,
				]);
				setTitle("");
				setDescription("");
			} catch {
				setError("Could not create project.");
			}
		});
	};

	const setStatus = (id: string, status: string) => {
		setProjects((prev) =>
			prev.map((p) => (p.id === id ? { ...p, status } : p)),
		);
		start(async () => {
			try {
				const res = await fetch(`/api/app/projects/${id}`, {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ status }),
				});
				if (!res.ok) throw new Error(String(res.status));
			} catch {
				// best-effort; a reload reflects server truth
			}
		});
	};

	const remove = (id: string) => {
		const previous = projects;
		setProjects((prev) => prev.filter((p) => p.id !== id));
		start(async () => {
			try {
				const res = await fetch(`/api/app/projects/${id}`, {
					method: "DELETE",
				});
				if (!res.ok) throw new Error(String(res.status));
			} catch {
				setProjects(previous);
			}
		});
	};

	const merge = (fromId: string, toId: string) => {
		const previous = projects;
		const from = projects.find((p) => p.id === fromId);
		setMergeFromId(null);
		setMergeToId(null);
		setProjects((prev) =>
			prev
				.filter((p) => p.id !== fromId)
				.map((p) =>
					p.id === toId
						? { ...p, postCount: p.postCount + (from?.postCount ?? 0) }
						: p,
				),
		);
		start(async () => {
			try {
				const res = await fetch("/api/app/projects/merge", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ fromId, toId }),
				});
				if (!res.ok) throw new Error(String(res.status));
			} catch {
				setProjects(previous);
				setError("Could not merge focus areas.");
			}
		});
	};

	const renderRow = (p: ProjectRow) => {
		const chips = autoChips(p.description);
		const mergeTargets = projects.filter(
			(t) => t.id !== p.id && t.status !== "archived",
		);
		const merging = mergeFromId === p.id;
		return (
			<li
				key={p.id}
				className="hairline-b flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 py-4"
			>
				<div className="min-w-0 flex-1">
					<span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<Link
							href={`/projects/${p.id}`}
							className="font-display italic text-[20px] text-[var(--fg)] transition-colors hover:text-[var(--color-accent)]"
						>
							{p.title}
						</Link>
						<span className="nums-lining font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
							{p.postCount} filed
						</span>
						{p.autoCreated ? (
							<span
								title="Created automatically from captured material"
								className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--fg-faint)]"
							>
								Auto
							</span>
						) : null}
						{p.status === "archived" ? (
							<span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
								Archived
							</span>
						) : null}
					</span>
					{chips !== null ? (
						chips.length > 0 ? (
							<span className="mt-1.5 flex flex-wrap gap-1.5">
								{chips.map((chip) => (
									<span
										key={chip}
										className="border border-[var(--color-rule)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--fg-muted)]"
									>
										{chip}
									</span>
								))}
							</span>
						) : null
					) : p.description ? (
						<p className="mt-1 truncate font-body text-[14px] text-[var(--fg-muted)]">
							{p.description}
						</p>
					) : null}
				</div>
				<div className="flex shrink-0 items-baseline gap-4 font-mono text-[10px] uppercase tracking-[0.22em]">
					{merging ? (
						<>
							<label className="inline-flex items-baseline gap-2 text-[var(--fg-muted)]">
								<span>Into</span>
								<select
									value={mergeToId ?? ""}
									onChange={(e) => setMergeToId(e.target.value || null)}
									className="border-b border-[var(--color-rule)] bg-transparent pb-0.5 font-display text-[13px] normal-case tracking-normal text-[var(--fg)] outline-none focus:border-[var(--color-accent)]"
								>
									<option value="">— choose —</option>
									{mergeTargets.map((t) => (
										<option key={t.id} value={t.id}>
											{t.title}
										</option>
									))}
								</select>
							</label>
							<button
								type="button"
								onClick={() => mergeToId && merge(p.id, mergeToId)}
								disabled={pending || !mergeToId}
								className="text-[var(--color-accent)] transition-opacity hover:opacity-70 disabled:opacity-40"
							>
								Confirm
							</button>
							<button
								type="button"
								onClick={() => {
									setMergeFromId(null);
									setMergeToId(null);
								}}
								className="text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
							>
								Cancel
							</button>
						</>
					) : (
						<>
							<button
								type="button"
								onClick={() =>
									setStatus(
										p.id,
										p.status === "archived" ? "active" : "archived",
									)
								}
								disabled={pending}
								className="text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
							>
								{p.status === "archived" ? "Restore" : "Archive"}
							</button>
							{mergeTargets.length > 0 ? (
								<button
									type="button"
									onClick={() => {
										setMergeFromId(p.id);
										setMergeToId(null);
									}}
									disabled={pending}
									className="text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
								>
									Merge
								</button>
							) : null}
							<button
								type="button"
								onClick={() => remove(p.id)}
								disabled={pending}
								className="text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
							>
								Delete
							</button>
						</>
					)}
				</div>
			</li>
		);
	};

	// The aspiration detail page already scopes the list — render it flat there.
	const grouped = presetAspirationId == null;
	const groups = grouped ? groupByAspiration(projects, aspirations) : null;

	return (
		<div className="space-y-8">
			<div className="hairline-b space-y-3 pb-7">
				<input
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="New focus area — e.g. Launch Q4 campaign"
					className="w-full border-b border-[var(--color-rule)] bg-transparent pb-1 font-display italic text-[22px] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--fg-faint)] focus:border-[var(--color-accent)]"
				/>
				<textarea
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="What is this focus area about? (optional)"
					rows={2}
					className="w-full resize-none bg-transparent font-body text-[15px] leading-relaxed text-[var(--fg-muted)] outline-none placeholder:text-[var(--fg-faint)]"
				/>
				<div className="flex flex-wrap items-center justify-between gap-3">
					{presetAspirationId == null && aspirations.length > 0 ? (
						<label className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)]">
							<span>Under</span>
							<select
								value={aspirationId ?? ""}
								onChange={(e) =>
									setAspirationId(e.target.value === "" ? null : e.target.value)
								}
								className="border-b border-[var(--color-rule)] bg-transparent pb-0.5 font-display text-[14px] normal-case tracking-normal text-[var(--fg)] outline-none focus:border-[var(--color-accent)]"
							>
								<option value="">— Standalone —</option>
								{aspirations.map((a) => (
									<option key={a.id} value={a.id}>
										{a.title}
									</option>
								))}
							</select>
						</label>
					) : (
						<span />
					)}
					<button
						type="button"
						onClick={create}
						disabled={pending || title.trim() === ""}
						className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] transition-opacity hover:opacity-70 disabled:opacity-40"
					>
						Add focus area →
					</button>
				</div>
				{error ? (
					<p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
						{error}
					</p>
				) : null}
			</div>

			{projects.length === 0 ? (
				<p className="font-display italic text-[17px] text-[var(--fg-subtle)]">
					No focus areas yet.
				</p>
			) : groups ? (
				<div className="space-y-10">
					{groups.map((group) => (
						<section key={group.aspirationId ?? "standalone"}>
							<div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-rule-emphatic)] pb-2">
								{group.aspirationId ? (
									<Link
										href={`/aspirations/${group.aspirationId}`}
										className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:text-[var(--color-accent)]"
									>
										{group.title}
									</Link>
								) : (
									<span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fg-muted)]">
										{group.title}
									</span>
								)}
								<span className="nums-lining font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
									{group.filed} filed
								</span>
							</div>
							<ul className="space-y-0">{group.projects.map(renderRow)}</ul>
						</section>
					))}
				</div>
			) : (
				<ul className="space-y-0">{projects.map(renderRow)}</ul>
			)}
		</div>
	);
}
