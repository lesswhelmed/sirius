import type { PostWithSubmitter } from "@repo/db";
import Link from "next/link";
import { getCachedCatalog } from "../../../lib/cached";
import { DateDisplay } from "../../../lib/date-display";
import { PostImage } from "../../_chrome/post-image";
import { CatalogSearch } from "./search";

// The public catalog index: published posts across all users.
// Shown to signed-out visitors at /catalog. Signed-in users get the private
// owner catalog instead (see page.tsx).
export async function PublicCatalog({ q }: { q: string }) {
  const { items } = await getCachedCatalog(q || undefined, 120);
  const listings = items as PostWithSubmitter[];

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            The Catalog
          </p>
          <h1 className="mt-1 font-display italic text-[44px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[56px]">
            Curated<span className="text-[var(--color-accent)]">,</span>{" "}
            <span className="not-italic">in the open.</span>
          </h1>
          <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
            Entries people have captured, refined, and chosen to publish. Sign
            up to start curating your own.
          </p>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-display italic text-[36px] leading-none text-[var(--color-accent)] nums-oldstyle">
            {listings.length}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            entries
          </span>
        </div>
      </header>

      <div className="hairline-t mt-7 pt-4">
        <CatalogSearch initial={q} />
      </div>

      {listings.length === 0 ? (
        <div className="mt-10 border-y border-[var(--color-rule)] py-20 text-center">
          <p className="font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">
            The catalog is empty.
          </p>
          <p className="mt-3 text-[15px] text-[var(--fg-subtle)]">
            Check back soon — or{" "}
            <Link
              href="/sign-up"
              className="text-[var(--color-accent)] underline underline-offset-4"
            >
              sign up and start your own
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((post) => (
            <li key={post.id}>
              <Link href={`/listing/${post.slug}`} className="group block">
                <div className="relative aspect-[4/5] w-full overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunken)]">
                  <PostImage
                    src={post.imageUrl}
                    alt={post.title}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                </div>
                <div className="mt-3">
                  <h2 className="font-display text-[20px] leading-tight tracking-[-0.005em] text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)]">
                    {post.title}
                  </h2>
                  <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
                    {post.submittedBy?.handle ? (
                      <span className="truncate">
                        @{post.submittedBy.handle}
                      </span>
                    ) : (
                      <span className="truncate text-[var(--fg-faint)]">
                        anon
                      </span>
                    )}
                    <DateDisplay value={post.originalDate ?? post.createdAt} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
