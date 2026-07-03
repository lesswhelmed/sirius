"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Kebab overflow menu on a PEER's post (App Store Guideline 1.2 Parts B/C):
// "Report post" opens a reason picker + optional note; "Block @handle" confirms
// then blocks. Rendered by CatalogCard when showAuthor is true (the Friends
// feed), so it must never appear on the viewer's own posts. On block success we
// router.refresh() so the author's posts vanish from the server-rendered feed
// instantly — the visibility query excludes blocked authors.

const REASONS = [
  { value: "OBJECTIONABLE", label: "Objectionable" },
  { value: "ABUSE", label: "Abuse" },
  { value: "SPAM", label: "Spam" },
  { value: "OTHER", label: "Other" },
] as const;

type ReasonValue = (typeof REASONS)[number]["value"];

type Panel = "menu" | "report" | null;

export function PostModerationMenu({
  slug,
  authorId,
  authorHandle,
}: {
  slug: string;
  authorId: string;
  authorHandle: string | null;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState<ReasonValue>("OBJECTIONABLE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

  // Close on outside click while any panel is open.
  useEffect(() => {
    if (!panel) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPanel(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [panel]);

  const authorLabel = authorHandle ? `@${authorHandle}` : "this user";

  async function submitReport() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/app/posts/${slug}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(`report failed (${res.status})`);
      setReported(true);
      setPanel(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "report failed");
    } finally {
      setBusy(false);
    }
  }

  async function blockAuthor() {
    if (busy) return;
    const ok = window.confirm(
      `Block ${authorLabel}? Their posts disappear from your feed and you are removed from each other's friends and groups.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/app/users/${authorId}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postSlug: slug }),
      });
      if (!res.ok) throw new Error(`block failed (${res.status})`);
      setPanel(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "block failed");
      setBusy(false);
    }
  }

  if (reported) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-sage)]">
        Reported — we review within 24 hours.
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={panel !== null}
        aria-label={`Post options for ${authorLabel}'s post`}
        onClick={() => setPanel(panel ? null : "menu")}
        className="px-1 font-mono text-[12px] leading-none text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
      >
        ⋯
      </button>

      {panel === "menu" ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[180px] border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)] py-1 shadow-sm"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => setPanel("report")}
            className="block w-full px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
          >
            Report post
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={blockAuthor}
            disabled={busy}
            className="block w-full px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-deep)] disabled:opacity-50"
          >
            {busy ? "Blocking…" : `Block ${authorLabel}`}
          </button>
        </div>
      ) : null}

      {panel === "report" ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-[240px] border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)] p-3 shadow-sm">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
            Report post
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {REASONS.map((r) => (
              <label
                key={r.value}
                className="flex cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)]"
              >
                <input
                  type="radio"
                  name={`report-reason-${slug}`}
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="accent-[var(--color-accent)]"
                />
                {r.label}
              </label>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            rows={2}
            maxLength={2000}
            className="mt-2 w-full border border-[var(--color-rule)] bg-transparent p-2 font-body text-[13px] text-[var(--fg)] placeholder:text-[var(--fg-faint)]"
          />
          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setPanel(null)}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitReport}
              disabled={busy}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-deep)] disabled:opacity-50"
            >
              {busy ? "Reporting…" : "Report"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <span className="ml-2 font-mono text-[10px] text-[var(--color-accent)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
