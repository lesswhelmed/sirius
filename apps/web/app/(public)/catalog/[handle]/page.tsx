import Link from "next/link";
import { notFound } from "next/navigation";
import { getCachedStorefront } from "../../../../lib/cached";
import { denyCatalogAccess } from "../../../../lib/catalog-access";
import { DateDisplay } from "../../../../lib/date-display";
import { PUBLIC_CATALOG_ENABLED } from "../../../../lib/features";
import { getSessionOrNull } from "../../../../lib/session";
import { PostImage } from "../../../_chrome/post-image";

export default async function PublicCatalogPage({
	params,
}: {
	params: Promise<{ handle: string }>;
}) {
	const { handle } = await params;
	const result = await getCachedStorefront(handle, 120);
	if (!result) {
		notFound();
	}

	// While the public catalog is disabled, a storefront is only its owner's
	// (published-only) self-preview. Everyone else is redirected.
	if (!PUBLIC_CATALOG_ENABLED) {
		const viewerId = (await getSessionOrNull())?.user.id ?? null;
		if (viewerId == null || result.user.id !== viewerId) {
			denyCatalogAccess(viewerId, `/catalog/${handle}`);
		}
	}

	const { user, posts } = result;

	return (
		<section>
			<header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
				<div>
					<p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
						Catalog · @{user.handle}
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
						entries
					</span>
				</div>
			</header>

			{posts.items.length === 0 ? (
				<div className="mt-10 border-y border-[var(--color-rule)] py-20 text-center">
					<p className="font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">
						Nothing in this catalog yet.
					</p>
				</div>
			) : (
				<ul className="mt-10 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
					{posts.items.map((post) => (
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
