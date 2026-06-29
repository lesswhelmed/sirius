import { getUserHandle, publicTierPolicy } from "@repo/db";
import { redirect } from "next/navigation";
import {
  ANONYMOUS_CATALOG_ENABLED,
  PUBLIC_CATALOG_ENABLED,
} from "../../../lib/features";
import { getSessionOrNull } from "../../../lib/session";
import { OwnerCatalog } from "./owner-catalog";
import { PublicCatalog } from "./public-catalog";

// /catalog serves two audiences from one URL:
//  - signed-in: the owner's private catalog (all their posts, every status)
//  - signed-out: the public catalog (everyone's published posts)
// The shared (public) chrome already swaps in the signed-in nav when a session
// is present, so the page only needs to branch the body.
//
// The signed-out body is an ANONYMOUS surface, so it gates on the policy's
// anonymousPublic tier: while truly-anonymous browsing is off there is no public,
// cross-user catalog and anonymous visitors are sent to sign in.
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

  const { anonymousPublic } = publicTierPolicy({
    publicCatalogEnabled: PUBLIC_CATALOG_ENABLED,
    anonymousCatalogEnabled: ANONYMOUS_CATALOG_ENABLED,
  });
  if (!anonymousPublic) {
    redirect("/sign-in?next=/catalog");
  }

  const q = typeof params.q === "string" ? params.q.trim() : "";
  return <PublicCatalog q={q} />;
}
