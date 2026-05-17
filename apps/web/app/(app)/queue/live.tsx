"use client";

import type { IngestSubmission } from "@repo/db";
import { useEffect, useMemo, useState } from "react";

function toDate(value: Date | string | null | undefined): Date {
  if (!value) return new Date(0);
  return value instanceof Date ? value : new Date(value);
}

function rowKey(item: IngestSubmission): string {
  return `${item.id}::${item.status}::${String(item.updatedAt)}`;
}

function arraysDiffer(
  a: IngestSubmission[],
  b: IngestSubmission[]
): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (!ai || !bi) return true;
    if (rowKey(ai) !== rowKey(bi)) return true;
  }
  return false;
}

function relativeAge(value: Date | string): string {
  const ms = Date.now() - toDate(value).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

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

const STATUS_ORDER: Status[] = [
  "pending",
  "processing",
  "completed",
  "failed",
  "skipped",
];

const DOT_CLASS: Record<Status, string> = {
  pending: "bg-[var(--status-pending)]",
  processing: "bg-[var(--status-processing)] animate-pulse",
  completed: "bg-[var(--status-completed)]",
  failed: "bg-[var(--status-failed)]",
  skipped: "bg-[var(--status-skipped)]",
};

const TEXT_CLASS: Record<Status, string> = {
  pending: "text-[var(--fg-muted)]",
  processing: "text-[var(--accent)]",
  completed: "text-[var(--status-completed)]",
  failed: "text-[var(--status-failed)]",
  skipped: "text-[var(--fg-subtle)]",
};

function StatusDot({ status }: { status: string }) {
  const cls = DOT_CLASS[status as Status] ?? "bg-[var(--fg-muted)]";
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`}
      aria-hidden="true"
    />
  );
}

function StatusChip({ status, count }: { status: Status; count: number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em]">
      <span
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[status]}`}
        aria-hidden="true"
      />
      <span className={TEXT_CLASS[status]}>{status}</span>
      <span className="tabular-nums text-[var(--fg)]">{count}</span>
    </span>
  );
}

function Row({ item }: { item: IngestSubmission }) {
  const status = item.status as Status;
  const label = primaryLabel(item);
  const isFailed = status === "failed";

  return (
    <div
      className={[
        "grid grid-cols-[auto_64px_88px_1fr_64px] items-center gap-3 px-4 py-2.5",
        "hairline-b transition-colors duration-100 hover:bg-[var(--surface-2)]",
        isFailed ? "line-through opacity-60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={isFailed && item.errorMessage ? item.errorMessage : undefined}
    >
      <StatusDot status={item.status} />
      <span className="truncate font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--fg-muted)]">
        {item.kind}
      </span>
      <span className="truncate font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--fg-subtle)]">
        {item.id.slice(0, 8)}
      </span>
      <span className="min-w-0 truncate text-[14px] text-[var(--fg)]">
        {label}
      </span>
      <span className="text-right font-mono text-[11px] uppercase tracking-[0.1em] tabular-nums text-[var(--fg-muted)]">
        {relativeAge(item.createdAt)}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center py-16 text-center text-[13px] text-[var(--fg-muted)]">
      No submissions yet. Capture something on{" "}
      <a
        href="/ingest"
        className="ml-1 text-[var(--accent)] underline-offset-2 hover:underline"
      >
        Ingest
      </a>
      .
    </div>
  );
}

export function Live({
  initialItems,
}: {
  initialItems: IngestSubmission[];
}) {
  const [items, setItems] = useState<IngestSubmission[]>(initialItems);
  const [, setTick] = useState(0);

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
        if (!cancelled) {
          setItems((prev) =>
            arraysDiffer(prev, data.items) ? data.items : prev
          );
        }
      } catch {
        // swallow polling errors; next tick retries
      }
    }
    const id = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const counts = useMemo<Record<string, number>>(() => {
    return items.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [items]);

  const activeChips = STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-3">
      {activeChips.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2"
          role="status"
          aria-live="polite"
        >
          {activeChips.map((s) => (
            <StatusChip key={s} status={s} count={counts[s] ?? 0} />
          ))}
        </div>
      ) : null}

      <div
        className="surface-raised overflow-hidden rounded-[8px]"
        role="list"
        aria-label="Ingest submission queue"
      >
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          items.map((item) => (
            <div key={item.id} role="listitem">
              <Row item={item} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
