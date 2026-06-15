import Link from "next/link";
import { notFound } from "next/navigation";
import { Streamdown } from "streamdown";
import { PostStatus } from "@repo/db";

import { DateDisplay } from "../../../../lib/date-display";
import { getCachedPost } from "../../../../lib/cached";
import { PostImage } from "../../../_chrome/post-image";

const MARKDOWN_CLASS_NAME = [
  "drop-cap break-words font-body text-[18px] leading-[1.7] text-[var(--fg)]",
  "[&_p]:my-5 [&_p:first-child]:mt-0",
  "[&_a]:text-[var(--color-accent)] [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-[var(--color-accent-deep)]",
  "[&_h1]:mt-10 [&_h1]:font-display [&_h1]:text-[38px] [&_h1]:leading-none [&_h1]:tracking-[-0.01em]",
  "[&_h2]:mt-9 [&_h2]:font-display [&_h2]:text-[30px] [&_h2]:leading-tight",
  "[&_h3]:mt-8 [&_h3]:font-display [&_h3]:text-[24px] [&_h3]:leading-tight",
  "[&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_li]:my-1.5 [&_blockquote]:my-7 [&_blockquote]:border-l [&_blockquote]:border-[var(--color-accent)] [&_blockquote]:pl-5 [&_blockquote]:italic [&_blockquote]:text-[var(--fg-muted)]",
  "[&_code]:font-mono [&_code]:text-[0.86em] [&_code]:text-[var(--color-accent-deep)]",
  "[&_pre]:my-7 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-[var(--color-rule)] [&_pre]:bg-[var(--color-paper-raised)] [&_pre]:p-4",
  "[&_img]:my-8 [&_img]:block [&_img]:w-full [&_img]:rounded-sm [&_img]:border [&_img]:border-[var(--color-rule)]",
  "[&_hr]:my-10 [&_hr]:border-[var(--color-rule-emphatic)] [&_table]:my-7 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[var(--color-rule)] [&_td]:border [&_td]:border-[var(--color-rule)] [&_th]:p-2 [&_td]:p-2",
].join(" ");

export default async function ListingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getCachedPost(slug);
  if (!post || post.status !== PostStatus.PUBLISHED) {
    notFound();
  }

  const authorHandle = post.submittedBy?.handle ?? null;

  return (
    <article className="mx-auto max-w-[1100px]">
      <Link
        href={authorHandle ? `/catalog/${authorHandle}` : "/catalog"}
        className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
      >
        <span aria-hidden="true">←</span>
        {authorHandle ? `Back to @${authorHandle}` : "Back to catalog"}
      </Link>

      <header className="mt-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-y border-[var(--color-rule-emphatic)] py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)]">
          <span className="text-[var(--color-accent)]">Entry</span>
          {authorHandle ? (
            <>
              <span aria-hidden="true" className="text-[var(--fg-faint)]">
                ·
              </span>
              <Link
                href={`/catalog/${authorHandle}`}
                className="hover:text-[var(--color-accent)]"
              >
                @{authorHandle}
              </Link>
            </>
          ) : null}
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

      <div className="mt-12 grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {post.imageUrl ? (
            <div className="relative mb-8 aspect-[4/5] w-full overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunken)]">
              <PostImage
                src={post.imageUrl}
                alt={post.title}
                sizes="(max-width: 1024px) 100vw, 65vw"
                priority
              />
            </div>
          ) : null}
          <Streamdown className={MARKDOWN_CLASS_NAME} mode="static">
            {post.content}
          </Streamdown>
        </div>

        <aside className="space-y-7 lg:border-l lg:border-[var(--color-rule)] lg:pl-8">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
              Provenance
            </p>
            <div className="mt-2 space-y-1 font-mono text-[12px] text-[var(--fg-muted)]">
              {post.originalUrl ? (
                <div>
                  <a
                    href={post.originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all italic text-[var(--color-accent)] underline underline-offset-4"
                  >
                    {post.originalUrl}
                  </a>
                </div>
              ) : (
                <div>Source unknown</div>
              )}
            </div>
          </div>

          {post.tags.length > 0 ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                Tags
              </p>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
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
            </div>
          ) : null}

          {post.categories.length > 0 ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                Categories
              </p>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
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
            </div>
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
