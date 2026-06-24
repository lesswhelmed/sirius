"use client";

import type { IngestSubmission } from "@repo/db";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { DateDisplay } from "../../../lib/date-display";
import { relativeAge } from "../../../lib/datetime";

type PayloadUrl = { urls?: string[] };
type PayloadNote = { notes?: string };

function primaryLabel(item: IngestSubmission): string {
  if (item.resultPostSlug) return item.resultPostSlug;

  const payload = item.payload as Record<string, unknown> | null | undefined;

  if (item.kind === "url") {
    const urls = (payload as PayloadUrl)?.urls;
    return urls?.[0] ?? "—";
  }

  if (item.kind === "note") {
    const notes = (payload as PayloadNote)?.notes ?? "";
    return notes.slice(0, 80) || "—";
  }

  if (item.kind === "image") {
    if (item.batchId && item.imageIndex != null && item.totalCount != null) {
      return `Image batch · ${item.imageIndex + 1}/${item.totalCount}`;
    }
    return "Image";
  }

  return "—";
}

type Status = "pending" | "processing" | "completed" | "failed" | "skipped";

const STATUS_GLYPH: Record<Status, string> = {
  pending: "○",
  processing: "◐",
  completed: "●",
  failed: "✕",
  skipped: "—",
};

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending",
  processing: "Setting",
  completed: "Filed",
  failed: "Spiked",
  skipped: "Skipped",
};

const STATUS_TONE: Record<Status, string> = {
  pending: "text-[var(--fg-muted)]",
  processing: "text-[var(--color-accent)]",
  completed: "text-[var(--color-sage)]",
  failed: "text-[var(--color-accent-deep)]",
  skipped: "text-[var(--fg-subtle)]",
};

function StatusGlyph({ status }: { status: Status }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block w-4 text-center font-mono text-[14px] leading-none ${STATUS_TONE[status]} ${
        status === "processing" ? "animate-pulse" : ""
      }`}
    >
      {STATUS_GLYPH[status]}
    </span>
  );
}

// Only non-terminal / needs-attention rows live in the in-flight section.
// `completed` items leave this section and surface as normal post cards in the
// server-rendered list below; `skipped` (idempotent dedupes) never need attention.
const IN_FLIGHT: ReadonlySet<Status> = new Set<Status>([
  "pending",
  "processing",
  "failed",
]);

function Row({
  item,
  now,
  onDismiss,
}: {
  item: IngestSubmission;
  now: number | null;
  onDismiss: (id: string) => void;
}) {
  const status = item.status as Status;
  const label = primaryLabel(item);
  const isFailed = status === "failed";

  const ageTooltip = now !== null ? relativeAge(item.createdAt, now) : undefined;

  return (
    <div
      className={[
        "border-b border-[var(--color-rule)] px-1 py-2.5",
        "md:grid md:grid-cols-[1.5rem_5rem_5rem_1fr_5rem_1.5rem] md:items-baseline md:gap-3",
        isFailed ? "opacity-80" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-baseline gap-2 md:contents">
        <StatusGlyph status={status} />
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.18em] ${STATUS_TONE[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
          {item.kind}
        </span>
      </div>
      <span className="mt-1 flex min-w-0 items-baseline gap-2 md:mt-0">
        <span
          className={`min-w-0 truncate font-display text-[16px] leading-snug md:text-[18px] ${
            isFailed ? "italic text-[var(--fg-muted)]" : "text-[var(--fg)]"
          }`}
        >
          {label}
        </span>
      </span>
      <DateDisplay
        value={item.createdAt}
        variant="time"
        title={ageTooltip}
        className="mt-1 block font-mono text-[11px] tabular-nums text-[var(--fg-muted)] md:mt-0 md:text-right"
      />
      {isFailed ? (
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          aria-label="Dismiss"
          className="mt-2 inline-flex h-5 w-5 items-center justify-center self-start justify-self-end font-mono text-[14px] leading-none text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent-deep)] md:mt-0"
        >
          ✕
        </button>
      ) : (
        <span className="hidden md:block" aria-hidden="true" />
      )}
      {isFailed && item.errorMessage ? (
        <p className="col-span-full mt-1 font-mono text-[11px] leading-snug text-[var(--fg-muted)]">
          {item.errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export function InFlight() {
  const router = useRouter();
  const [items, setItems] = useState<IngestSubmission[]>([]);
  const [now, setNow] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Track the prior poll's statuses by id so we can detect a row transitioning
  // out of pending/processing into completed and re-fetch the post list in place.
  // Lazy-init (null sentinel + ??=) so we don't allocate a throwaway Map/Set on
  // every render — useRef ignores the arg after the first render anyway.
  const prevStatusRef = useRef<Map<string, Status> | null>(null);
  prevStatusRef.current ??= new Map();
  // Ids the user dismissed locally. Polls filter these out so the next 3s tick
  // can't re-add a just-dismissed row before the server DELETE lands.
  const dismissedIdsRef = useRef<Set<string> | null>(null);
  dismissedIdsRef.current ??= new Set();

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/app/queue?limit=50", {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          items: IngestSubmission[];
          nextCursor: string | null;
        };
        if (cancelled) return;

        // Did anything we were watching (pending/processing) just become
        // completed? If so, the server list needs to re-render to show the post.
        let resolved = false;
        for (const it of data.items) {
          const before = prevStatusRef.current!.get(it.id);
          if (
            (before === "pending" || before === "processing") &&
            it.status === "completed"
          ) {
            resolved = true;
            break;
          }
        }

        const nextStatus = new Map<string, Status>();
        for (const it of data.items) {
          nextStatus.set(it.id, it.status as Status);
        }
        prevStatusRef.current = nextStatus;

        setItems(
          data.items.filter(
            (it) =>
              IN_FLIGHT.has(it.status as Status) &&
              !dismissedIdsRef.current!.has(it.id),
          ),
        );

        if (resolved) router.refresh();
      } catch {
        // swallow polling errors; next tick retries
      }
    }
    void poll();
    const id = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [router]);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  async function dismiss(id: string) {
    // Guard the poller and optimistically remove from the visible list. We drop
    // the row on a 204 (deleted) OR a 404 (already gone / wrong status) — either
    // way it should disappear.
    dismissedIdsRef.current!.add(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
    try {
      const res = await fetch(`/api/app/queue/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 404) {
        // Server rejected it for some other reason — un-guard so a later poll
        // can resurface it rather than silently hiding a still-live row.
        dismissedIdsRef.current!.delete(id);
      }
    } catch {
      dismissedIdsRef.current!.delete(id);
    }
  }

  function dismissAll() {
    for (const it of items) {
      if ((it.status as Status) === "failed") void dismiss(it.id);
    }
  }

  const counts = useMemo(() => {
    let processing = 0;
    let pending = 0;
    let failed = 0;
    for (const it of items) {
      const s = it.status as Status;
      if (s === "processing") processing += 1;
      else if (s === "pending") pending += 1;
      else if (s === "failed") failed += 1;
    }
    return { processing, pending, failed };
  }, [items]);

  const summary = useMemo(() => {
    // Fold pending into "processing" so the strip reads like the approved mockup
    // ("1 processing · 2 failed") and matches the mobile summary — the pending vs
    // processing distinction isn't meaningful to the owner watching the wire.
    const inMotion = counts.processing + counts.pending;
    const segments: string[] = [];
    if (inMotion > 0) segments.push(`${inMotion} processing`);
    if (counts.failed > 0) segments.push(`${counts.failed} failed`);
    return segments.join(" · ");
  }, [counts]);

  const hasFailed = counts.failed > 0;

  if (items.length === 0) return null;

  return (
    <section className="hairline-t mt-7 pt-6" aria-label="In flight">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-1 py-1 text-left transition-colors hover:opacity-90"
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
          In flight — {summary}
        </span>
        <span
          aria-hidden="true"
          className={`shrink-0 font-mono text-[12px] leading-none text-[var(--fg-subtle)] transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
      </button>

      {expanded ? (
        <div className="mt-3 border-t-2 border-[var(--color-rule-emphatic)]">
          <div role="list" aria-label="In-flight submissions" aria-live="polite">
            {items.map((item) => (
              <div key={item.id} role="listitem">
                <Row item={item} now={now} onDismiss={dismiss} />
              </div>
            ))}
          </div>
          {hasFailed ? (
            <div className="flex justify-end px-1 pt-2.5">
              <button
                type="button"
                onClick={dismissAll}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent-deep)]"
              >
                Dismiss all
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
