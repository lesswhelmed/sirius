"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Non-owner moderation controls on the post detail page (App Store Guideline
// 1.2 Parts B/C), mirroring delete-post-button.tsx's client-button pattern.
// Report opens a small inline reason picker; Block confirms, blocks the author,
// and redirects to /friends (this page's content is no longer visible to the
// viewer once the author is blocked). Never rendered for the owner.

const REASONS = [
  { value: "OBJECTIONABLE", label: "Objectionable" },
  { value: "ABUSE", label: "Abuse" },
  { value: "SPAM", label: "Spam" },
  { value: "OTHER", label: "Other" },
] as const;

type ReasonValue = (typeof REASONS)[number]["value"];

export function ReportBlockControls({
  slug,
  authorId,
  authorHandle,
}: {
  slug: string;
  authorId: string | null;
  authorHandle: string | null;
}) {
  const router = useRouter();
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<ReasonValue>("OBJECTIONABLE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

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
      setReportOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "report failed");
    } finally {
      setBusy(false);
    }
  }

  async function blockAuthor() {
    if (busy || !authorId) return;
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
      router.push("/friends");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "block failed");
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-flex items-baseline gap-4">
      {reported ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-sage)]">
          Reported — we review within 24 hours.
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setReportOpen((v) => !v)}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
        >
          Report
        </button>
      )}
      {authorId ? (
        <button
          type="button"
          onClick={blockAuthor}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
        >
          {busy ? "Blocking…" : `Block ${authorLabel}`}
        </button>
      ) : null}
      {error ? (
        <span className="font-mono text-[10px] text-[var(--color-accent)]">
          {error}
        </span>
      ) : null}

      {reportOpen && !reported ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-[240px] border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)] p-3 text-left shadow-sm">
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
                  name="detail-report-reason"
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
              onClick={() => setReportOpen(false)}
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
    </div>
  );
}
