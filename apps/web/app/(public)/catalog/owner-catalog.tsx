import Link from "next/link";
import { listPostsPage, type PostSort, PostStatus, PostType } from "@repo/db";
import { CatalogCard } from "./catalog-card";
import { OwnerFilters, type SortOption } from "./owner-filters";
import { Pagination } from "./pagination";

const TYPES: PostType[] = ["CONCRETE", "BLOG", "FINDING", "SIGHT", "SOCIAL"];
const STATUSES: PostStatus[] = ["PUBLISHED", "DRAFT", "ARCHIVED"];

const TYPE_LABEL: Record<PostType, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

// Order matters: the first entry is the default and is dropped from the URL.
const SORTS: SortOption[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "title", label: "Title" },
];
const DEFAULT_SORT: PostSort = "newest";

const PAGE_SIZE = 24;

function pickEnum<T extends string>(
  value: string | null,
  valid: T[]
): T | undefined {
  if (!value) return undefined;
  return (valid as string[]).includes(value) ? (value as T) : undefined;
}

// The private catalog for the signed-in owner: every post they have ingested,
// across all kinds and statuses (drafts and archived included). Scoped by
// submittedById so it never leaks another user's work.
export async function OwnerCatalog({
  userId,
  userName,
  handle,
  searchParams,
}: {
  userId: string;
  userName: string;
  handle: string | null;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const typeParam =
    typeof searchParams.type === "string" ? searchParams.type : null;
  const statusParam =
    typeof searchParams.status === "string" ? searchParams.status : null;
  const qParam =
    typeof searchParams.q === "string" ? searchParams.q : undefined;
  const sortParam =
    typeof searchParams.sort === "string" ? searchParams.sort : null;
  const pageParam =
    typeof searchParams.page === "string"
      ? Number.parseInt(searchParams.page, 10)
      : 1;

  const type = pickEnum<PostType>(typeParam, TYPES);
  const status = pickEnum<PostStatus>(statusParam, STATUSES);
  const sort =
    pickEnum<PostSort>(
      sortParam,
      SORTS.map((s) => s.value)
    ) ?? DEFAULT_SORT;

  // Read the owner's private catalog directly per-request — NEVER through a
  // shared `use cache` wrapper. This is personalized, session-scoped data
  // (drafts + archived included); caching it cross-request risks one account
  // seeing another's posts after a re-login. The page is already dynamic
  // (it reads the session), so this is just a normal per-request DB query,
  // exactly like the queue/space pages do with session.user.id.
  const { items, total, page, totalPages } = await listPostsPage({
    submittedById: userId,
    type,
    status,
    q: qParam,
    sort,
    page: Number.isFinite(pageParam) ? pageParam : 1,
    pageSize: PAGE_SIZE,
  });

  const isFiltered = Boolean(type || status || (qParam && qParam.length > 0));

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Private catalog
            {handle ? (
              <>
                <span aria-hidden="true" className="mx-2 text-[var(--fg-faint)]">
                  ·
                </span>
                <span className="text-[var(--color-accent)]">@{handle}</span>
              </>
            ) : null}
          </p>
          <h1 className="mt-1 font-display italic text-[44px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[56px]">
            The Catalog<span className="text-[var(--color-accent)]">.</span>
          </h1>
          <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
            Everything {userName.split(" ")[0] || "you"} has captured and curated
            — dispatches, findings, sights, social, and concretes — across every
            status, in one place.
          </p>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-display italic text-[36px] leading-none text-[var(--color-accent)] nums-oldstyle">
            {total}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            {isFiltered ? "matches" : "on file"}
          </span>
        </div>
      </header>

      <div className="hairline-t mt-7 pt-4">
        <OwnerFilters
          types={TYPES}
          statuses={STATUSES}
          typeLabels={TYPE_LABEL}
          sorts={SORTS}
          defaultSort={DEFAULT_SORT}
          activeType={type}
          activeStatus={status}
          activeSort={sort}
          q={qParam ?? ""}
        />
      </div>

      {items.length === 0 ? (
        <div className="mt-10 border-y border-[var(--color-rule)] py-20 text-center">
          <p
            aria-hidden="true"
            className="font-display italic text-[56px] leading-none text-[var(--color-rule-strong)]"
          >
            ∅
          </p>
          <p className="mt-5 font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">
            {isFiltered
              ? "Nothing matches those filters."
              : "Your catalog is empty."}
          </p>
          <p className="mt-3 text-[15px] text-[var(--fg-subtle)]">
            {isFiltered ? (
              "Loosen a filter or clear the search to see more of your work."
            ) : (
              <>
                Submit something on{" "}
                <Link
                  href="/ingest"
                  className="text-[var(--color-accent)] underline underline-offset-4"
                >
                  Ingest
                </Link>{" "}
                to fill it.
              </>
            )}
          </p>
        </div>
      ) : (
        <ul className="mt-8 border-t border-[var(--color-rule-emphatic)]">
          {items.map((post) => (
            <li
              key={post.id}
              className="border-b border-[var(--color-rule)] transition-colors hover:bg-[var(--color-paper-raised)]/40"
            >
              <CatalogCard post={post} />
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="rule-emphatic-t mt-10 pt-4">
          <Pagination page={page} totalPages={totalPages} />
        </div>
      ) : null}
    </section>
  );
}
