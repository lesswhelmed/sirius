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

// A single catalog entry as a horizontal ledger row. Every row shares the same
// skeleton — a fixed plate slot on the left and the text block on the right —
// so an entry with no image keeps the column aligned and reads as deliberate
// rather than broken. The plate slot falls back to a quiet typographic mark.
export function CatalogCard({ post }: { post: Post }) {
  const host = sourceHost(post.originalUrl);

  return (
    <Link
      href={`/posts/${post.slug}`}
      className="group flex gap-4 py-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-ring)] sm:gap-6"
      aria-label={`${post.title} — ${TYPE_LABEL[post.type]}, ${post.status.toLowerCase()}`}
    >
      <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunken)] sm:w-40">
        {post.imageUrl ? (
          <PostImage
            src={post.imageUrl}
            alt={post.title}
            sizes="(max-width: 640px) 96px, 160px"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <span
            aria-hidden="true"
            className={`flex h-full w-full items-center justify-center font-display italic text-[15px] leading-none opacity-45 sm:text-[18px] ${TYPE_TONE[post.type]}`}
          >
            {TYPE_LABEL[post.type]}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.18em] ${TYPE_TONE[post.type]}`}
          >
            {TYPE_LABEL[post.type]}
          </span>
          <StatusPip status={post.status} />
        </div>

        <h2 className="mt-1.5 font-display text-[22px] leading-tight tracking-[-0.005em] text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)] text-balance sm:text-[26px]">
          {post.title}
        </h2>

        {post.excerpt ? (
          <p className="mt-1.5 line-clamp-2 font-body text-[14px] leading-relaxed text-[var(--fg-muted)] sm:text-[15px]">
            {post.excerpt}
          </p>
        ) : null}

        <div className="mt-auto flex items-baseline justify-between gap-3 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
          <DateDisplay value={post.originalDate ?? post.createdAt} />
          {host ? <span className="truncate">{host}</span> : null}
        </div>
      </div>
    </Link>
  );
}
