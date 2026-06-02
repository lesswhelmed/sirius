"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

export interface ProjectRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  aspirationId: string | null;
}

export interface AspirationOption {
  id: string;
  title: string;
}

// Create / list / archive / delete projects. Reused by the flat /projects page
// (with an aspiration picker) and the aspiration detail page (with a preset
// aspirationId, picker hidden). Mirrors the optimistic island pattern.
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
    presetAspirationId
  );
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
        const data = (await res.json()) as { project: ProjectRow };
        setProjects((prev) => [data.project, ...prev]);
        setTitle("");
        setDescription("");
      } catch {
        setError("Could not create project.");
      }
    });
  };

  const setStatus = (id: string, status: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status } : p))
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
      ) : (
        <ul className="space-y-0">
          {projects.map((p) => (
            <li
              key={p.id}
              className="hairline-b flex items-baseline justify-between gap-4 py-4"
            >
              <div className="min-w-0">
                <Link
                  href={`/projects/${p.id}`}
                  className="font-display italic text-[20px] text-[var(--fg)] transition-colors hover:text-[var(--color-accent)]"
                >
                  {p.title}
                </Link>
                {p.status === "archived" ? (
                  <span className="ml-3 font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                    Archived
                  </span>
                ) : null}
                {p.description ? (
                  <p className="mt-1 truncate font-body text-[14px] text-[var(--fg-muted)]">
                    {p.description}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-baseline gap-4 font-mono text-[10px] uppercase tracking-[0.22em]">
                <button
                  type="button"
                  onClick={() =>
                    setStatus(p.id, p.status === "archived" ? "active" : "archived")
                  }
                  disabled={pending}
                  className="text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
                >
                  {p.status === "archived" ? "Restore" : "Archive"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  disabled={pending}
                  className="text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
