"use client";

import { useState, useTransition } from "react";

export interface ProjectOption {
	id: string;
	title: string;
}

// Files a post under a Project (or clears it). Mirrors save-button.tsx's
// optimistic + revert-on-failure pattern. Options are passed from the server
// parent so the control needs no client fetch to populate.
export function AssignToProject({
	slug,
	currentProjectId,
	projects,
	canAssign,
}: {
	slug: string;
	currentProjectId: string | null;
	projects: ProjectOption[];
	canAssign: boolean;
}) {
	const [projectId, setProjectId] = useState<string | null>(currentProjectId);
	const [pending, start] = useTransition();

	if (!canAssign) {
		return null;
	}

	const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const next = e.target.value === "" ? null : e.target.value;
		const previous = projectId;
		setProjectId(next); // optimistic
		start(async () => {
			try {
				const res = await fetch(`/api/app/posts/${slug}/project`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ projectId: next }),
				});
				if (!res.ok) throw new Error(String(res.status));
			} catch {
				setProjectId(previous); // revert on failure
			}
		});
	};

	return (
		<label className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)]">
			<span aria-hidden="true">❖</span>
			<span>Focus</span>
			<select
				value={projectId ?? ""}
				onChange={onChange}
				disabled={pending}
				className="border-b border-[var(--color-rule)] bg-transparent pb-0.5 font-display text-[14px] tracking-normal normal-case text-[var(--fg)] outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-50"
			>
				<option value="">— None —</option>
				{projects.map((p) => (
					<option key={p.id} value={p.id}>
						{p.title}
					</option>
				))}
			</select>
		</label>
	);
}
