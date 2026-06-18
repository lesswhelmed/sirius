// Master switch for the PUBLIC, cross-user catalog: anonymous browse of other
// people's published posts, their /catalog/<handle> storefronts, and the public
// /listing/<slug> pages + the /api/catalog* feeds.
//
// Disabled until a "friends"/sharing model exists. While false, every catalog
// surface is OWNER-ONLY — the per-post read rule lives in canReadPost()
// (lib/post-access.ts). To bring public/shared browsing back: flip this to true
// AND widen canReadPost for the sharing/friends rule. This is the ONLY place the
// policy is decided — nothing else should hardcode it.
export const PUBLIC_CATALOG_ENABLED = false;
