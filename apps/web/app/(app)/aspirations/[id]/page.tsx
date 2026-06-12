import Link from "next/link";
import { notFound } from "next/navigation";
import { getAspiration } from "@repo/db";

import { requireSession } from "../../../../lib/session";
import { isAutoCreated } from "../../../../lib/projects/metadata";
import { ProjectsBoard } from "../../projects/projects-board";

export default async function AspirationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession("/aspirations");
  const { id } = await params;
  const aspiration = await getAspiration(session.user.id, id);
  if (!aspiration) {
    notFound();
  }

  return (
    <section className="mx-auto max-w-[920px]">
      <Link
        href="/aspirations"
        className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
      >
        <span aria-hidden="true">←</span>
        Return to Aspirations
      </Link>

      <header className="mt-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-y border-[var(--color-rule-emphatic)] py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)]">
          <span className="text-[var(--color-accent)]">Aspiration</span>
          <span aria-hidden="true" className="text-[var(--fg-faint)]">
            ·
          </span>
          <span className="nums-lining">
            {aspiration.projects.length} focus areas
          </span>
        </div>

        <h1 className="mt-6 font-display text-[44px] leading-[0.98] tracking-[-0.015em] text-balance sm:text-[56px]">
          {aspiration.title}
        </h1>

        {aspiration.description ? (
          <p className="mt-6 max-w-[52ch] font-display italic text-[20px] leading-[1.35] text-[var(--fg-muted)] text-pretty">
            {aspiration.description}
          </p>
        ) : null}
      </header>

      <div className="mt-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Focus areas under this aspiration
        </p>
        <div className="mt-5">
          <ProjectsBoard
            presetAspirationId={aspiration.id}
            initialProjects={aspiration.projects.map((p) => ({
              id: p.id,
              title: p.title,
              description: p.description,
              status: p.status,
              aspirationId: p.aspirationId,
              postCount: p._count.posts,
              autoCreated: isAutoCreated(p.metadata),
            }))}
          />
        </div>
      </div>
    </section>
  );
}
