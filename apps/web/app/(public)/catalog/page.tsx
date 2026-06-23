import { getUserHandle } from "@repo/db";
import { redirect } from "next/navigation";
import { PUBLIC_CATALOG_ENABLED } from "../../../lib/features";
import { getSessionOrNull } from "../../../lib/session";
import { OwnerCatalog } from "./owner-catalog";
import { PublicCatalog } from "./public-catalog";

// /catalog serves two audiences from one URL:
//  - signed-in: the owner's private catalog (all their posts, every status)
//  - signed-out: the public catalog (everyone's published posts)
// The shared (public) chrome already swaps in the signed-in nav when a session
// is present, so the page only needs to branch the body.
//
// While PUBLIC_CATALOG_ENABLED is false the signed-out body is gated: there is
// no public, cross-user catalog, so anonymous visitors are sent to sign in.
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, session] = await Promise.all([
    searchParams,
    getSessionOrNull(),
  ]);

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

  if (!PUBLIC_CATALOG_ENABLED) {
    redirect("/sign-in?next=/catalog");
  }

  const q = typeof params.q === "string" ? params.q.trim() : "";
  return <PublicCatalog q={q} />;
}
