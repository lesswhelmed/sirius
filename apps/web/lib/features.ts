// Master switch for the PUBLIC, cross-user catalog among SIGNED-IN users: a
// signed-in viewer may read another user's PUBLIC posts (the friends feed's
// includePublic branch, and the cockpit/listing read tiers in canReadPost).
//
// Safe to flip on now that visibility defaults to PRIVATE: turning it on exposes
// NOTHING until an owner deliberately marks a post PUBLIC. Friends sharing works
// regardless of this flag (it gates the PUBLIC tier only). canReadPost()
// (lib/post-access.ts) is the ONLY place the policy is applied — nothing else
// should hardcode it.
export const PUBLIC_CATALOG_ENABLED = false;

// Second stage: truly ANONYMOUS, no-session browsing — the public /catalog,
// /catalog/<handle> storefronts, /listing/<slug> pages and /api/catalog* feeds
// served to logged-out visitors and search engines. Kept SEPARATE from (and
// stricter than) PUBLIC_CATALOG_ENABLED because anonymous exposure is
// irreversible (scrapable/indexable). Do NOT flip without product sign-off and
// an explicit per-post "make publicly discoverable" confirmation UX.
export const ANONYMOUS_CATALOG_ENABLED = false;
