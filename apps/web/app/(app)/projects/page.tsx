import Link from "next/link";
import { listAspirations, listProjects } from "@repo/db";

import { requireSession } from "../../../lib/session";
import { ProjectsBoard } from "./projects-board";

export default async function ProjectsPage() {
  const session = await requireSession("/projects");
  const [projectPage, aspirationPage] = await Promise.all([
    listProjects(session.user.id, { limit: 100 }),
    listAspirations(session.user.id, { limit: 100 }),
  ]);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Section IV — Focus
          </p>
          <h1 className="mt-1 font-display italic text-[40px] leading-[0.95] tracking-[-0.01em] sm:text-[48px]">
            Focus Areas<span className="text-[var(--color-accent)]">.</span>
          </h1>
          <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
            Concrete projects you file captured work under. Group them beneath an
            aspiration, or keep them standalone.
          </p>
        </header>

        <Link
          href="/aspirations"
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
        >
          Aspirations →
        </Link>
      </div>

      <div className="hairline-t mt-7 pt-7">
        <ProjectsBoard
          initialProjects={projectPage.items.map((p) => ({
            id: p.id,
            title: p.title,
            description: p.description,
            status: p.status,
            aspirationId: p.aspirationId,
          }))}
          aspirations={aspirationPage.items.map((a) => ({
            id: a.id,
            title: a.title,
          }))}
        />
      </div>
    </section>
  );
}
