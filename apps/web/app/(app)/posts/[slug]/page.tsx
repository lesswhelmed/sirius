import Link from "next/link";
import { notFound } from "next/navigation";
import { findPostBySlug } from "@repo/db";

function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

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
    <article className="mx-auto max-w-[820px]">
      <Link
        href="/library"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] hover:text-[var(--fg)]"
      >
        ← Library
      </Link>

      <div className="mt-6 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">
        <span className="text-[var(--accent)]">{post.type}</span>
        <span>·</span>
        <span>{post.status}</span>
        <span>·</span>
        <span>{formatDate(post.originalDate ?? post.createdAt)}</span>
      </div>

      <h1 className="mt-3 text-[36px] font-medium leading-tight tracking-[-0.01em]">
        {post.title}
      </h1>

      {post.excerpt ? (
        <p className="mt-4 text-[18px] leading-relaxed text-[var(--fg-muted)]">
          {post.excerpt}
        </p>
      ) : null}

      <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="prose max-w-none text-[15.5px] leading-[1.7] text-[var(--fg)]">
          <pre className="whitespace-pre-wrap break-words font-sans">
            {post.content}
          </pre>
        </div>

        <aside className="space-y-6">
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
                  className="break-all text-[var(--accent)] underline-offset-4 hover:underline"
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
                <div className="flex flex-wrap gap-1.5">
                  {post.tags.map((t) => (
                    <span
                      key={t.id}
                      className="rounded-[var(--radius-chip)] border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--fg-muted)]"
                    >
                      {t.name}
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
                <div className="flex flex-wrap gap-1.5">
                  {post.categories.map((c) => (
                    <span
                      key={c.id}
                      className="rounded-[var(--radius-chip)] bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--fg-muted)]"
                    >
                      {c.displayName}
                    </span>
                  ))}
                </div>
              }
            />
          ) : null}
        </aside>
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
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--fg-subtle)]">
        {label}
      </p>
      <div
        className={`mt-1 text-[13px] text-[var(--fg)] ${mono ? "font-mono break-all" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
