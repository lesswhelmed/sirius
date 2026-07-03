import type { PostListItem, PostStatus, PostType } from "@repo/db";
import Link from "next/link";
import { DateDisplay } from "../../../lib/date-display";
import { PostModerationMenu } from "../../(app)/friends/post-moderation-menu";
import { PostImage } from "../../_chrome/post-image";
import { RepoChip } from "../../_chrome/repo-chip";

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
  FINDING: "text-[var(--color-mark-text)]",
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

// The owner-facing audience mark: shows whom *you* shared this with. Driven by
// ownAudience (owner-only — peer rows carry null, so nothing renders). PRIVATE
// is silent. GROUP shows the group name and deep-links to the manager.
function AudienceBadge({ audience }: { audience: PostListItem["ownAudience"] }) {
  if (!audience) return null;
  if (audience.visibility === "FRIENDS") {
    return (
      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-sage)]">
        <span aria-hidden="true">◐</span>friends
      </span>
    );
  }
  if (audience.visibility === "PUBLIC") {
    return (
      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
        <span aria-hidden="true">◯</span>public
      </span>
    );
  }
  // GROUP
  const [first, ...rest] = audience.groups;
  if (!first) return null;
  const extra = rest.length > 0 ? ` +${rest.length}` : "";
  return (
    <Link
      href={`/friends?tab=groups&group=${encodeURIComponent(first.id)}`}
      className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-mark-text)] transition-colors hover:text-[var(--color-accent)]"
    >
      <span aria-hidden="true">▣</span>
      {first.name}
      {extra} <span aria-hidden="true">→</span>
    </Link>
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

// The per-row taxonomy: ONE bordered serif category pill (structural — a post
// has exactly one category) clearly distinct from a wrap of small mono tag chips
// (annotations). Both are links into the filtered catalog, so they sit OUTSIDE
// the card's main post link (nested anchors are invalid HTML).
function TaxonomyFooter({
  category,
  tags,
}: {
  category: { displayName: string; slug: string } | undefined;
  tags: { name: string; slug: string }[];
}) {
  if (!category && tags.length === 0) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--color-rule)] pt-3">
      {category ? (
        <Link
          href={`/catalog?category=${encodeURIComponent(category.slug)}`}
          className="inline-block border border-[var(--color-rule)] px-3 py-1 font-display text-[14px] italic text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          {category.displayName}
        </Link>
      ) : null}
      {tags.length > 0 ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {tags.map((tag) => (
            <Link
              key={tag.slug}
              href={`/catalog?tag=${encodeURIComponent(tag.slug)}`}
              className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
            >
              #{tag.name}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// A single catalog entry as a horizontal ledger row. Every row shares the same
// skeleton — a fixed plate slot on the left and the text block on the right —
// so an entry with no image keeps the column aligned and reads as deliberate
// rather than broken. The plate slot falls back to a quiet typographic mark.
export function CatalogCard({
  post,
  showAuthor = false,
}: {
  post: PostListItem;
  // In the Friends feed each row belongs to a different author, so surface whose
  // post it is; in the owner's own catalog every post is theirs, so omit it.
  showAuthor?: boolean;
}) {
  const host = sourceHost(post.originalUrl);
  const href = `/posts/${post.slug}`;
  const author = post.submittedBy;
  // A post carries exactly one category in the shipped model; take the first.
  const category = post.categories?.[0];
  const tags = post.tags ?? [];

  return (
    <article className="group flex gap-4 py-5 sm:gap-6">
      <Link
        href={href}
        aria-hidden="true"
        tabIndex={-1}
        className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunken)] sm:w-40"
      >
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
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={href}
          className="flex flex-col rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-ring)]"
          aria-label={`${post.title} — ${TYPE_LABEL[post.type]}, ${post.status.toLowerCase()}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.18em] ${TYPE_TONE[post.type]}`}
            >
              {TYPE_LABEL[post.type]}
            </span>
            <span className="flex items-center gap-3">
              <AudienceBadge audience={post.ownAudience} />
              <StatusPip status={post.status} />
            </span>
          </div>

          <h2 className="mt-1.5 font-display text-[22px] leading-tight tracking-[-0.005em] text-balance text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)] sm:text-[26px]">
            {post.title}
          </h2>

          {post.excerpt ? (
            <p className="mt-1.5 line-clamp-2 font-body text-[14px] leading-relaxed text-[var(--fg-muted)] sm:text-[15px]">
              {post.excerpt}
            </p>
          ) : null}
        </Link>

        <div className="mt-auto flex items-baseline justify-between gap-3 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
          <span className="flex items-baseline gap-3">
            <DateDisplay value={post.originalDate ?? post.createdAt} />
            {showAuthor && author ? (
              <span className="text-[var(--fg-muted)]">
                {author.handle ? `@${author.handle}` : author.name}
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-3">
            {post.providerId === "github" ? (
              <RepoChip
                providerId={post.providerId}
                contentDigest={post.contentDigest}
              />
            ) : host ? (
              <span className="truncate">{host}</span>
            ) : null}
            {/* Report/Block overflow — peer posts only (showAuthor implies the
                row belongs to another author; never rendered on own posts). */}
            {showAuthor && author ? (
              <PostModerationMenu
                slug={post.slug}
                authorId={author.id}
                authorHandle={author.handle}
              />
            ) : null}
          </span>
        </div>

        <TaxonomyFooter category={category} tags={tags} />
      </div>
    </article>
  );
}
