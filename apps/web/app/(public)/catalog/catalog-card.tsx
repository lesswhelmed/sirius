import Link from "next/link";
import type { Post, PostStatus, PostType } from "@repo/db";
import { DateDisplay } from "../../../lib/date-display";
import { PostImage } from "../../_chrome/post-image";

const TYPE_LABEL: Record<PostType, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

// One oxblood-or-secondary tone per kind, mirroring the rest of the journal.
const TYPE_TONE: Record<PostType, string> = {
  CONCRETE: "text-[var(--color-ink)]",
  BLOG: "text-[var(--color-sage)]",
  FINDING: "text-[var(--color-mark)]",
  SIGHT: "text-[var(--color-accent)]",
  SOCIAL: "text-[var(--color-ink-muted)]",
};

const STATUS_PIP: Record<PostStatus, string> = {
  PUBLISHED: "bg-[var(--color-sage)]",
  DRAFT: "bg-[var(--color-mark)]",
  ARCHIVED: "bg-[var(--fg-subtle)]",
};

function StatusPip({ status }: { status: PostStatus }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 ${STATUS_PIP[status]}`}
      />
      {status.toLowerCase()}
    </span>
  );
}

function sourceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Image-led entry: a plate above an editorial caption block.
function ImageCard({ post }: { post: Post }) {
  return (
    <Link
      href={`/posts/${post.slug}`}
      className="group block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-ring)]"
      aria-label={`${post.title} — ${TYPE_LABEL[post.type]}, ${post.status.toLowerCase()}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunken)]">
        <PostImage
          src={post.imageUrl}
          alt={post.title}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        />
        <span className="absolute bottom-0 left-0 bg-[rgb(28_22_18/0.74)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-paper)]">
          {TYPE_LABEL[post.type]}
        </span>
      </div>

      <div className="mt-3 border-b border-[var(--color-rule)] pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-[20px] leading-tight tracking-[-0.005em] text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)] text-balance">
            {post.title}
          </h2>
          <StatusPip status={post.status} />
        </div>
        {post.excerpt ? (
          <p className="mt-2 line-clamp-2 font-body text-[14px] leading-relaxed text-[var(--fg-muted)]">
            {post.excerpt}
          </p>
        ) : null}
        <DateDisplay
          value={post.originalDate ?? post.createdAt}
          className="mt-3 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]"
        />
      </div>
    </Link>
  );
}

// Text-forward entry: no plate, so the kind label, title, and excerpt carry it.
// Deliberately the same visual weight as an image card so non-visual content
// never reads as a lesser fallback.
function TextCard({ post }: { post: Post }) {
  const host = sourceHost(post.originalUrl);
  return (
    <Link
      href={`/posts/${post.slug}`}
      className="group flex h-full flex-col border-t border-[var(--color-rule-emphatic)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-ring)]"
      aria-label={`${post.title} — ${TYPE_LABEL[post.type]}, ${post.status.toLowerCase()}`}
    >
      <article className="flex h-full flex-col gap-3 border-b border-[var(--color-rule)] py-4">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.18em] ${TYPE_TONE[post.type]}`}
          >
            {TYPE_LABEL[post.type]}
          </span>
          <StatusPip status={post.status} />
        </div>

        <h2 className="font-display italic text-[24px] leading-[1.05] tracking-[-0.005em] text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)] text-balance">
          {post.title}
        </h2>

        {post.excerpt ? (
          <p className="line-clamp-3 flex-1 font-body text-[14px] leading-relaxed text-[var(--fg-muted)]">
            {post.excerpt}
          </p>
        ) : (
          <span className="flex-1" />
        )}

        <div className="flex items-baseline justify-between gap-3 border-t border-[var(--color-rule)] pt-2.5">
          <DateDisplay
            value={post.originalDate ?? post.createdAt}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]"
          />
          {host ? (
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
              {host}
            </span>
          ) : null}
        </div>
      </article>
    </Link>
  );
}

export function CatalogCard({ post }: { post: Post }) {
  return post.imageUrl ? <ImageCard post={post} /> : <TextCard post={post} />;
}
