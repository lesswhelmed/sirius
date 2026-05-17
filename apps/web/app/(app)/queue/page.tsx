import { listSubmissions } from "@repo/db";
import { Live } from "./live";

export default async function QueuePage() {
  const initial = await listSubmissions({ limit: 50 });

  return (
    <section>
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-[1fr_auto] md:items-end">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--fg-subtle)]">
            Section III — The Wire
          </p>
          <h1 className="mt-1 font-display italic text-[56px] leading-[0.92] tracking-[-0.01em]">
            In Flight<span className="text-[var(--color-accent)]">.</span>
          </h1>
          <p className="mt-3 max-w-md font-display italic text-[18px] leading-snug text-[var(--fg-muted)]">
            Submissions on their way through the press — pending, processing,
            filed, or spiked. Refreshes every three seconds.
          </p>
        </header>

        <div className="flex items-baseline gap-2 text-[var(--fg-subtle)]">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
            Live · polling 3s
          </span>
        </div>
      </div>

      <div className="rule-emphatic-t mt-8 pt-6">
        <Live initialItems={initial.items} />
      </div>
    </section>
  );
}
