import Link from "next/link";
import { notFound } from "next/navigation";
import { findPostBySlug } from "@repo/db";

import { DateDisplay } from "../../../../lib/date-display";

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
};

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await findPostBySlug(slug);
  if (!post) {
    notFound();
  }

  return (
    <article className="mx-auto max-w-[920px]">
      <Link
        href="/library"
        className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
      >
        <span aria-hidden="true">←</span>
        Return to Library
      </Link>

      <header className="mt-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-y border-[var(--color-rule-emphatic)] py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)]">
          <span className="text-[var(--color-accent)]">
            {TYPE_LABEL[post.type] ?? post.type}
          </span>
          <span aria-hidden="true" className="text-[var(--fg-faint)]">
            ·
          </span>
          <span>{post.status}</span>
          <span aria-hidden="true" className="text-[var(--fg-faint)]">
            ·
          </span>
          <DateDisplay
            value={post.originalDate ?? post.createdAt}
            variant="date-long"
          />
        </div>

        <h1 className="mt-6 font-display text-[44px] leading-[0.98] tracking-[-0.015em] text-balance sm:text-[56px] lg:text-[64px]">
          {post.title}
        </h1>

        {post.excerpt ? (
          <p className="mt-6 max-w-[44ch] font-display italic text-[22px] leading-[1.35] text-[var(--fg-muted)] text-pretty">
            {post.excerpt}
          </p>
        ) : null}
      </header>

      <div className="mt-12 grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="drop-cap whitespace-pre-wrap break-words font-body text-[18px] leading-[1.7] text-[var(--fg)]">
          {post.content}
        </div>

        <aside className="space-y-7 lg:border-l lg:border-[var(--color-rule)] lg:pl-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--fg-subtle)]">
            Colophon
          </div>
          <Meta label="Slug" value={post.slug} mono />
          <Meta label="Source" value={post.sourceType} mono />
          <Meta label="Provider" value={post.providerId} mono />
          {post.originalUrl ? (
            <Meta
              label="Original"
              value={
                <a
                  href={post.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all italic text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-accent-deep)]"
                >
                  {post.originalUrl}
                </a>
              }
            />
          ) : null}
          {post.tags.length > 0 ? (
            <Meta
              label="Tags"
              value={
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  {post.tags.map((t, i) => (
                    <span key={t.id} className="font-display italic text-[15px]">
                      {t.name}
                      {i < post.tags.length - 1 ? (
                        <span
                          aria-hidden="true"
                          className="ml-2 text-[var(--fg-subtle)]"
                        >
                          ,
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
              }
            />
          ) : null}
          {post.categories.length > 0 ? (
            <Meta
              label="Categories"
              value={
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  {post.categories.map((c, i) => (
                    <span key={c.id} className="font-display italic text-[15px]">
                      {c.displayName}
                      {i < post.categories.length - 1 ? (
                        <span
                          aria-hidden="true"
                          className="ml-2 text-[var(--fg-subtle)]"
                        >
                          ,
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
              }
            />
          ) : null}
        </aside>
      </div>

      <div className="mt-20 rule-emphatic-t pt-6 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--fg-subtle)]">
        <span aria-hidden="true" className="text-[var(--color-accent)]">
          ⁂
        </span>
      </div>
    </article>
  );
}

function Meta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        {label}
      </p>
      <div
        className={`mt-1.5 text-[14px] text-[var(--fg)] ${mono ? "font-mono break-all text-[12.5px]" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
