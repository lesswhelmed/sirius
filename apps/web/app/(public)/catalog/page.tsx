import { getUserHandle } from "@repo/db";
import { getSessionOrNull } from "../../../lib/session";
import { OwnerCatalog } from "./owner-catalog";
import { PublicCatalog } from "./public-catalog";

// /catalog serves two audiences from one URL:
//  - signed-in: the owner's private catalog (all their posts, every status)
//  - signed-out: the public broker storefront (published listings)
// The shared (public) chrome already swaps in the signed-in nav when a session
// is present, so the page only needs to branch the body.
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getSessionOrNull();

  if (session) {
    const handle = await getUserHandle(session.user.id);
    return (
      <OwnerCatalog
        userId={session.user.id}
        userName={session.user.name}
        handle={handle}
        searchParams={params}
      />
    );
  }

  const q = typeof params.q === "string" ? params.q.trim() : "";
  return <PublicCatalog q={q} />;
}
