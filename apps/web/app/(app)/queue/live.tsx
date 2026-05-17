"use client";

import type { IngestSubmission } from "@repo/db";
import { useEffect, useMemo, useState } from "react";

import { DateDisplay } from "../../../lib/date-display";
import { relativeAge } from "../../../lib/datetime";

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

function StatusCounter({ status, count }: { status: Status; count: number }) {
  return (
    <div className="flex items-baseline gap-2 border-l border-[var(--color-rule)] pl-4 first:border-l-0 first:pl-0">
      <span
        className={`font-display italic text-[32px] leading-none nums-oldstyle ${STATUS_TONE[status]}`}
      >
        {count}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-subtle)]">
        {STATUS_LABEL[status]}
      </span>
    </div>
  );
}

function Row({
  item,
  now,
  idx,
}: {
  item: IngestSubmission;
  now: number | null;
  idx: number;
}) {
  const status = item.status as Status;
  const label = primaryLabel(item);
  const isFailed = status === "failed";

  const ageTooltip = now !== null ? relativeAge(item.createdAt, now) : undefined;
  const rowTitle =
    isFailed && item.errorMessage ? item.errorMessage : undefined;

  return (
    <div
      className={[
        "border-b border-[var(--color-rule)] px-1 py-2.5",
        "transition-colors duration-100 hover:bg-[var(--color-paper-raised)]/50",
        "md:grid md:grid-cols-[2rem_1.5rem_5rem_5rem_1fr_5rem] md:items-baseline md:gap-3",
        isFailed ? "opacity-70" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={rowTitle}
    >
      <div className="flex items-baseline gap-2 md:contents">
        <span className="font-mono text-[10px] tabular-nums text-[var(--fg-subtle)]">
          {idx.toString().padStart(3, "0")}
        </span>
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
      <span
        className={`mt-1 block min-w-0 truncate font-display text-[16px] leading-snug md:mt-0 md:text-[18px] ${
          isFailed
            ? "italic line-through text-[var(--fg-muted)]"
            : "text-[var(--fg)]"
        }`}
      >
        {label}
      </span>
      <DateDisplay
        value={item.createdAt}
        variant="time"
        title={ageTooltip}
        className="mt-1 block font-mono text-[11px] tabular-nums text-[var(--fg-muted)] md:mt-0 md:text-right"
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-y border-[var(--color-rule)] py-20 text-center">
      <p className="font-display italic text-[28px] leading-tight text-[var(--fg-muted)]">
        Quiet on the wire.
      </p>
      <p className="mt-3 text-[15px] text-[var(--fg-subtle)]">
        Capture something on{" "}
        <a
          href="/ingest"
          className="text-[var(--color-accent)] underline underline-offset-4"
        >
          Ingest
        </a>{" "}
        and watch it move.
      </p>
    </div>
  );
}

export function Live({
  initialItems,
}: {
  initialItems: IngestSubmission[];
}) {
  const [items, setItems] = useState<IngestSubmission[]>(initialItems);
  const [now, setNow] = useState<number | null>(null);

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
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
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
    <div className="flex flex-col gap-6">
      {activeChips.length > 0 ? (
        <div
          className="flex flex-wrap items-baseline gap-5"
          role="status"
          aria-live="polite"
        >
          {activeChips.map((s) => (
            <StatusCounter key={s} status={s} count={counts[s] ?? 0} />
          ))}
        </div>
      ) : null}

      <div
        className="border-t-2 border-[var(--color-rule-emphatic)]"
        role="list"
        aria-label="Ingest submission queue"
      >
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          items.map((item, idx) => (
            <div key={item.id} role="listitem">
              <Row item={item} now={now} idx={idx + 1} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
