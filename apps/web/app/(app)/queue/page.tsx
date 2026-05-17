import { listSubmissions } from "@repo/db";
import { Live } from "./live";

export default async function QueuePage() {
  const initial = await listSubmissions({ limit: 50 });

  return (
    <section>
      <header className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
          Queue
        </p>
        <h1 className="mt-1 text-[28px] font-medium leading-tight">
          In flight
        </h1>
        <p className="mt-2 text-[14px] text-[var(--fg-muted)]">
          Live status of recent submissions. Updates every 3 seconds.
        </p>
      </header>

      <Live initialItems={initial.items} />
    </section>
  );
}
