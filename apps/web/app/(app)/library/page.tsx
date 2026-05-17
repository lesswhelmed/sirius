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
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Section II — Catalogue
          </p>
          <h1 className="mt-1 font-display italic text-[40px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[48px]">
            The Library<span className="text-[var(--color-accent)]">,</span>
          </h1>
          <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
            Everything captured and made into a post — sorted, filed, kept.
          </p>
        </header>

        <div className="flex items-baseline gap-2">
          <span className="font-display italic text-[36px] leading-none text-[var(--color-accent)] nums-oldstyle">
            {items.length}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            on file
          </span>
        </div>
      </div>

      <div className="hairline-t mt-7 pt-4">
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
          <p className="font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">
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
        <ol className="mt-6 rule-emphatic-b">
          <li className="hidden md:grid grid-cols-[3rem_7rem_1fr_6rem_5.5rem] items-baseline gap-4 border-t border-[var(--color-rule-emphatic)] border-b border-[var(--color-rule)] py-2 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span>No.</span>
            <span>Kind</span>
            <span>Title</span>
            <span className="text-right">Filed</span>
            <span className="text-right">Status</span>
          </li>
          {items.map((post, idx) => (
            <li
              key={post.id}
              className="group border-b border-[var(--color-rule)] transition-colors hover:bg-[var(--color-paper-raised)]/50"
            >
              <Link
                href={`/posts/${post.slug}`}
                className="block px-1 py-3 md:grid md:grid-cols-[3rem_7rem_1fr_6rem_5.5rem] md:items-baseline md:gap-4 md:py-3"
              >
                <div className="flex items-baseline gap-3 md:contents">
                  <span className="font-mono text-[11px] tabular-nums text-[var(--fg-subtle)] group-hover:text-[var(--color-accent)]">
                    {pad(idx + 1)}
                  </span>
                  <span
                    className={`font-display italic text-[15px] leading-tight ${TYPE_TONE[post.type]} md:text-[17px]`}
                  >
                    {TYPE_LABEL[post.type]}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-3 min-w-0 md:mt-0">
                  <span className="font-display text-[18px] leading-tight tracking-[-0.005em] text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)] md:text-[20px]">
                    {post.title}
                  </span>
                  <span className="hidden flex-1 translate-y-[-3px] leader-dots-line h-[6px] min-w-[2rem] lg:block" />
                  <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)] lg:inline">
                    {post.slug}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3 md:mt-0 md:contents">
                  <DateDisplay
                    value={post.createdAt}
                    className="font-mono text-[11px] tabular-nums text-[var(--fg-muted)] md:text-right md:text-[12px]"
                  />
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.18em] md:text-right ${STATUS_TONE[post.status]}`}
                  >
                    {post.status.toLowerCase()}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
