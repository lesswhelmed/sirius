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

function Row({ item, now }: { item: IngestSubmission; now: number | null }) {
  const status = item.status as Status;
  const label = primaryLabel(item);
  const isFailed = status === "failed";

  const ageTooltip = now !== null ? relativeAge(item.createdAt, now) : undefined;

  return (
    <div
      className={[
        "border-b border-[var(--color-rule)] px-1 py-2.5",
        "md:grid md:grid-cols-[1.5rem_5rem_5rem_1fr_5rem] md:items-baseline md:gap-3",
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
            isFailed
              ? "italic text-[var(--fg-muted)]"
              : "text-[var(--fg)]"
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
  // Track the prior poll's statuses by id so we can detect a row transitioning
  // out of pending/processing into completed and re-fetch the post list in place.
  const prevStatus = useRef<Map<string, Status>>(new Map());

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
          const before = prevStatus.current.get(it.id);
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
        prevStatus.current = nextStatus;

        setItems(data.items.filter((it) => IN_FLIGHT.has(it.status as Status)));

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

  const count = items.length;
  const sectionLabel = useMemo(
    () => (count === 1 ? "1 in flight" : `${count} in flight`),
    [count],
  );

  if (count === 0) return null;

  return (
    <section className="hairline-t mt-7 pt-6" aria-label="In flight">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          On the wire
        </p>
        <div className="flex items-baseline gap-2 text-[var(--fg-subtle)]">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
            {sectionLabel}
          </span>
        </div>
      </div>
      <div
        className="mt-4 border-t-2 border-[var(--color-rule-emphatic)]"
        role="list"
        aria-label="In-flight submissions"
        aria-live="polite"
      >
        {items.map((item) => (
          <div key={item.id} role="listitem">
            <Row item={item} now={now} />
          </div>
        ))}
      </div>
    </section>
  );
}
