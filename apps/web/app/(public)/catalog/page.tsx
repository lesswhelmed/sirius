import Link from "next/link";
import Image from "next/image";
import { listCatalogPosts, type PostWithSubmitter } from "@repo/db";
import { DateDisplay } from "../../../lib/date-display";
import { CatalogSearch } from "./search";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const { items } = await listCatalogPosts({ q: q || undefined, limit: 120 });
  const listings = items as PostWithSubmitter[];

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            The Broker
          </p>
          <h1 className="mt-1 font-display italic text-[44px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[56px]">
            Antique militaria<span className="text-[var(--color-accent)]">,</span>{" "}
            <span className="not-italic">filed for inquiry.</span>
          </h1>
          <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
            Listings ingested from collectors and dealers. To purchase, send the
            seller a note — Sirius brokers the introduction.
          </p>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-display italic text-[36px] leading-none text-[var(--color-accent)] nums-oldstyle">
            {listings.length}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            listings
          </span>
        </div>
      </header>

      <div className="hairline-t mt-7 pt-4">
        <CatalogSearch initial={q} />
      </div>

      {listings.length === 0 ? (
        <div className="mt-10 border-y border-[var(--color-rule)] py-20 text-center">
          <p className="font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">
            Nothing on the shelves yet.
          </p>
          <p className="mt-3 text-[15px] text-[var(--fg-subtle)]">
            Check back soon — or{" "}
            <Link
              href="/sign-up"
              className="text-[var(--color-accent)] underline underline-offset-4"
            >
              sign up and list your own
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
                  {post.imageUrl ? (
                    <Image
                      src={post.imageUrl}
                      alt={post.title}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      unoptimized={post.imageUrl.startsWith("/sight/")}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-subtle)]">
                      No plate
                    </div>
                  )}
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
