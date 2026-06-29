// The SINGLE derivation of the PUBLIC read tier from the two catalog surface
// flags. There are two independent switches in the product:
//   - publicCatalogEnabled    — cross-user PUBLIC reads among SIGNED-IN users.
//   - anonymousCatalogEnabled — truly anonymous, no-session browsing (the public
//     /catalog, storefronts, /listing pages, and /api/catalog* feeds served to
//     logged-out visitors and search engines).
//
// Rather than have every guard re-decide "may a signed-in viewer / an anonymous
// visitor see PUBLIC posts?", this module collapses the two flags into one
// PublicTierPolicy. The key invariant — enforced ONCE here — is that anonymous
// exposure implies signed-in exposure: you can't show logged-out visitors what
// signed-in users themselves can't see. So `anonymousPublic` turning on also
// turns on `signedInPublic`, regardless of `publicCatalogEnabled`.
//
// Pure module: no DB, no env reads, no I/O. Callers pass the already-resolved
// boolean flags (e.g. apps/web/lib/features.ts) and branch on the policy.

export type PublicTierPolicy = {
  // A SIGNED-IN viewer may read other users' published PUBLIC posts.
  signedInPublic: boolean;
  // A truly ANONYMOUS (no-session) visitor may read published PUBLIC posts.
  anonymousPublic: boolean;
};

export function publicTierPolicy(flags: {
  publicCatalogEnabled: boolean;
  anonymousCatalogEnabled: boolean;
}): PublicTierPolicy {
  // anonymous exposure implies signed-in exposure (can't show logged-out
  // visitors what signed-in users can't see) — enforced ONCE here.
  const signedInPublic =
    flags.publicCatalogEnabled || flags.anonymousCatalogEnabled;
  return { signedInPublic, anonymousPublic: flags.anonymousCatalogEnabled };
}
