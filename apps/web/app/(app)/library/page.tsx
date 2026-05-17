import Link from "next/link";
import { listPosts, PostStatus, PostType } from "@repo/db";
import { Filters } from "./filters";

const TYPES: PostType[] = ["CONCRETE", "BLOG", "FINDING", "SIGHT"];
const STATUSES: PostStatus[] = ["PUBLISHED", "DRAFT", "ARCHIVED"];

function pickEnum<T extends string>(value: string | null, valid: T[]): T | undefined {
  if (!value) return undefined;
  return (valid as string[]).includes(value) ? (value as T) : undefined;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

const TYPE_TONE: Record<PostType, string> = {
  CONCRETE: "text-[var(--fg)] border-[var(--border-strong)]",
  BLOG: "text-[var(--accent)] border-[color:var(--color-accent-soft)]",
  FINDING: "text-[var(--status-completed)] border-[var(--border-strong)]",
  SIGHT: "text-[var(--status-failed)] border-[var(--border-strong)]",
};

const STATUS_TONE: Record<PostStatus, string> = {
  PUBLISHED: "bg-[color:var(--color-accent-soft)] text-[var(--accent)]",
  DRAFT: "bg-[var(--surface-2)] text-[var(--fg-muted)]",
  ARCHIVED: "bg-[var(--surface-2)] text-[var(--fg-subtle)]",
};

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
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
            Library
          </p>
          <h1 className="mt-1 text-[28px] font-medium leading-tight">
            Your work · {items.length}
          </h1>
        </div>
        <Filters
          types={TYPES}
          statuses={STATUSES}
          activeType={type}
          activeStatus={status}
          q={qParam ?? ""}
        />
      </header>

      {items.length === 0 ? (
        <div className="surface-raised rounded-[var(--radius-card)] px-6 py-12 text-center text-[14px] text-[var(--fg-muted)]">
          Nothing here yet. Submit something on{" "}
          <Link
            href="/ingest"
            className="text-[var(--accent)] underline-offset-4 hover:underline"
          >
            Ingest
          </Link>
          .
        </div>
      ) : (
        <div className="surface-raised overflow-hidden rounded-[var(--radius-card)]">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="hairline-b text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--fg-subtle)]">
                <th className="px-4 py-3 font-normal">Date</th>
                <th className="px-4 py-3 font-normal">Type</th>
                <th className="px-4 py-3 font-normal">Title</th>
                <th className="px-4 py-3 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((post) => (
                <tr
                  key={post.id}
                  className="hairline-b last:border-b-0 transition-colors hover:bg-[var(--surface-2)]"
                >
                  <td className="px-4 py-3 align-top">
                    <span className="font-mono text-[12px] text-[var(--fg-muted)]">
                      {formatDate(post.createdAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={`inline-flex items-center rounded-[var(--radius-chip)] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${TYPE_TONE[post.type]}`}
                    >
                      {post.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/posts/${post.slug}`}
                      className="block text-[14px] text-[var(--fg)] hover:text-[var(--accent)]"
                    >
                      {post.title}
                      <span className="mt-0.5 block font-mono text-[11px] text-[var(--fg-subtle)]">
                        {post.slug}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={`inline-flex items-center rounded-[var(--radius-chip)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${STATUS_TONE[post.status]}`}
                    >
                      {post.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
