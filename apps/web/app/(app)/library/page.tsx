import Link from "next/link";
import { listPosts, PostStatus, PostType } from "@repo/db";
import { Filters } from "./filters";
import { DateDisplay } from "../../../lib/date-display";

const TYPES: PostType[] = ["CONCRETE", "BLOG", "FINDING", "SIGHT"];
const STATUSES: PostStatus[] = ["PUBLISHED", "DRAFT", "ARCHIVED"];

function pickEnum<T extends string>(
  value: string | null,
  valid: T[]
): T | undefined {
  if (!value) return undefined;
  return (valid as string[]).includes(value) ? (value as T) : undefined;
}

const TYPE_LABEL: Record<PostType, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
};

const TYPE_TONE: Record<PostType, string> = {
  CONCRETE: "text-[var(--color-ink)]",
  BLOG: "text-[var(--color-accent)]",
  FINDING: "text-[var(--color-sage)]",
  SIGHT: "text-[var(--color-mark)]",
};

const STATUS_TONE: Record<PostStatus, string> = {
  PUBLISHED: "text-[var(--color-accent)]",
  DRAFT: "text-[var(--fg-muted)]",
  ARCHIVED: "text-[var(--fg-subtle)] line-through decoration-1",
};

function pad(n: number): string {
  return n.toString().padStart(3, "0");
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const typeParam = typeof params.type === "string" ? params.type : null;
  const statusParam = typeof params.status === "string" ? params.status : null;
  const qParam = typeof params.q === "string" ? params.q : undefined;

  const type = pickEnum<PostType>(typeParam, TYPES);
  const status = pickEnum<PostStatus>(statusParam, STATUSES);

  const { items } = await listPosts({ type, status, q: qParam, limit: 100 });

  return (
    <section>
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-[1fr_auto] md:items-end">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--fg-subtle)]">
            Section II — Catalogue
          </p>
          <h1 className="mt-1 font-display italic text-[56px] leading-[0.92] tracking-[-0.01em] text-balance">
            The Library<span className="text-[var(--color-accent)]">,</span>
          </h1>
          <p className="mt-3 max-w-md font-display italic text-[18px] leading-snug text-[var(--fg-muted)]">
            Everything captured and made into a post — sorted, filed, kept.
          </p>
        </header>

        <div className="flex items-baseline gap-3 md:flex-col md:items-end md:gap-1">
          <span className="font-display italic text-[44px] leading-none text-[var(--color-accent)] nums-oldstyle">
            {items.length}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            entries on file
          </span>
        </div>
      </div>

      <div className="rule-emphatic-t mt-8 pt-5">
        <Filters
          types={TYPES}
          statuses={STATUSES}
          activeType={type}
          activeStatus={status}
          q={qParam ?? ""}
        />
      </div>

      {items.length === 0 ? (
        <div className="mt-10 border-y border-[var(--color-rule)] py-20 text-center">
          <p className="font-display italic text-[28px] leading-tight text-[var(--fg-muted)]">
            The shelves are bare.
          </p>
          <p className="mt-3 text-[15px] text-[var(--fg-subtle)]">
            Submit something on{" "}
            <Link
              href="/ingest"
              className="text-[var(--color-accent)] underline underline-offset-4"
            >
              Ingest
            </Link>{" "}
            to fill them.
          </p>
        </div>
      ) : (
        <ol className="mt-8 rule-emphatic-b">
          <li className="grid grid-cols-[3.5rem_8rem_1fr_6.5rem_6rem] items-baseline gap-4 border-t border-[var(--color-rule-emphatic)] border-b border-[var(--color-rule)] py-2 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span>No.</span>
            <span>Kind</span>
            <span>Title</span>
            <span className="text-right">Filed</span>
            <span className="text-right">Status</span>
          </li>
          {items.map((post, idx) => (
            <li
              key={post.id}
              className="group grid grid-cols-[3.5rem_8rem_1fr_6.5rem_6rem] items-baseline gap-4 border-b border-[var(--color-rule)] py-4 transition-colors hover:bg-[var(--color-paper-raised)]/60"
            >
              <span className="font-mono text-[12px] tabular-nums text-[var(--fg-subtle)] group-hover:text-[var(--color-accent)]">
                {pad(idx + 1)}
              </span>
              <span
                className={`font-display italic text-[17px] leading-tight ${TYPE_TONE[post.type]}`}
              >
                {TYPE_LABEL[post.type]}
              </span>
              <Link
                href={`/posts/${post.slug}`}
                className="flex items-baseline gap-3 min-w-0"
              >
                <span className="font-display text-[20px] leading-tight tracking-[-0.005em] text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)]">
                  {post.title}
                </span>
                <span className="hidden flex-1 translate-y-[-3px] leader-dots-line h-[6px] min-w-[2rem] md:block" />
                <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)] md:inline">
                  {post.slug}
                </span>
              </Link>
              <DateDisplay
                value={post.createdAt}
                className="text-right font-mono text-[12px] tabular-nums text-[var(--fg-muted)]"
              />
              <span
                className={`text-right font-mono text-[10px] uppercase tracking-[0.18em] ${STATUS_TONE[post.status]}`}
              >
                {post.status.toLowerCase()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
