import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { listUserStorefront } from "@repo/db";
import { DateDisplay } from "../../../../lib/date-display";

export const dynamic = "force-dynamic";

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const result = await listUserStorefront(handle, { limit: 120 });
  if (!result) {
    notFound();
  }

  const { user, posts } = result;

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Shop · @{user.handle}
          </p>
          <h1 className="mt-1 font-display italic text-[44px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[56px]">
            {user.name}
            <span className="text-[var(--color-accent)]">.</span>
          </h1>
          {user.bio ? (
            <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
              {user.bio}
            </p>
          ) : null}
          {user.location ? (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
              {user.location}
            </p>
          ) : null}
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-display italic text-[36px] leading-none text-[var(--color-accent)] nums-oldstyle">
            {posts.items.length}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            on offer
          </span>
        </div>
      </header>

      {posts.items.length === 0 ? (
        <div className="mt-10 border-y border-[var(--color-rule)] py-20 text-center">
          <p className="font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">
            This shop is empty.
          </p>
        </div>
      ) : (
        <ul className="mt-10 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {posts.items.map((post) => (
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
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
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
