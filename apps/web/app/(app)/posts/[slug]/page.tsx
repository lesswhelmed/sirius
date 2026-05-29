import Link from "next/link";
import { notFound } from "next/navigation";
import { Streamdown } from "streamdown";
import { getPostViewStats, isPostSaved } from "@repo/db";

import { DateDisplay } from "../../../../lib/date-display";
import { getCachedPost } from "../../../../lib/cached";
import { getSessionOrNull } from "../../../../lib/session";
import { PostImage } from "../../../_chrome/post-image";
import { ColophonTabs } from "./colophon-tabs";
import { ViewBeacon } from "./view-beacon";

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

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getCachedPost(slug);
  if (!post) {
    notFound();
  }

  const session = await getSessionOrNull();
  const userId = session?.user.id ?? null;
  const [initialSaved, stats] = await Promise.all([
    userId ? isPostSaved(userId, post.id) : Promise.resolve(false),
    getPostViewStats(post.id),
  ]);

  return (
    <article className="mx-auto max-w-[920px]">
      <ViewBeacon slug={post.slug} />
      <Link
        href="/catalog"
        className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
      >
        <span aria-hidden="true">←</span>
        Return to Catalog
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

      <div className="mt-12 grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          {post.imageUrl ? (
            <div className="relative mb-8 aspect-[16/10] w-full overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunken)]">
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

        <ColophonTabs
          post={{
            slug: post.slug,
            sourceType: post.sourceType,
            providerId: post.providerId,
            sourceRecordId: post.sourceRecordId,
            sourceHash: post.sourceHash,
            syncStatus: post.syncStatus,
            originalUrl: post.originalUrl,
            imageUrl: post.imageUrl,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            lastEdited: post.lastEdited,
            lastSyncedAt: post.lastSyncedAt,
            originalDate: post.originalDate,
            tags: post.tags.map((t) => ({ id: t.id, name: t.name })),
            categories: post.categories.map((c) => ({
              id: c.id,
              displayName: c.displayName,
            })),
          }}
          stats={stats}
          initialSaved={initialSaved}
          canSave={userId != null}
        />
      </div>

      <div className="mt-20 rule-emphatic-t pt-6 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--fg-subtle)]">
        <span aria-hidden="true" className="text-[var(--color-accent)]">
          ⁂
        </span>
      </div>
    </article>
  );
}
