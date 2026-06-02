import Link from "next/link";
import { listAspirations, listProjects } from "@repo/db";

import { requireSession } from "../../../lib/session";
import { AspirationsBoard } from "./aspirations-board";

export default async function AspirationsPage() {
  const session = await requireSession("/aspirations");
  const [aspirationPage, projectPage] = await Promise.all([
    listAspirations(session.user.id, { limit: 100 }),
    listProjects(session.user.id, { limit: 200 }),
  ]);

  // Tally focus-area counts per aspiration from a single project query.
  const counts = new Map<string, number>();
  for (const p of projectPage.items) {
    if (p.aspirationId) {
      counts.set(p.aspirationId, (counts.get(p.aspirationId) ?? 0) + 1);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Section IV — Focus
          </p>
          <h1 className="mt-1 font-display italic text-[40px] leading-[0.95] tracking-[-0.01em] sm:text-[48px]">
            Aspirations<span className="text-[var(--color-accent)]">.</span>
          </h1>
          <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
            The big things you&rsquo;re working toward. Break each one into focus
            areas, then file your captured work beneath them.
          </p>
        </header>

        <Link
          href="/projects"
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
        >
          All focus areas →
        </Link>
      </div>

      <div className="hairline-t mt-7 pt-7">
        <AspirationsBoard
          initialAspirations={aspirationPage.items.map((a) => ({
            id: a.id,
            title: a.title,
            description: a.description,
            projectCount: counts.get(a.id) ?? 0,
          }))}
        />
      </div>
    </section>
  );
}
