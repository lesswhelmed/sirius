// Deterministic search fixtures. Slugs are stable keys joining posts to their
// snapshot embedding vectors (search-embeddings.json). Probe terms are nonsense
// words ("zephyrium", "quokkanet") so they never collide with English stemming.
export type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC";
export type Status = "DRAFT" | "PUBLISHED";

export interface FixtureUser {
  key: "viewer" | "friend" | "stranger";
  id: string;
  name: string;
  email: string;
  handle: string;
}

export interface FixturePost {
  slug: string;
  ownerKey: FixtureUser["key"];
  title: string;
  excerpt: string | null;
  content: string;
  type: "BLOG" | "FINDING" | "SIGHT";
  status: Status;
  visibility: Visibility;
  tags: string[]; // Tag.name values
  categories: string[]; // Category.name values
  createdAtIso: string;
}

export type AssertMode = "fts-only" | "fused";

export interface GoldenQuery {
  name: string;
  query: string;
  viewerKey: FixtureUser["key"];
  scope: "all" | "mine";
  mode: AssertMode; // fts-only => harness injects a throwing embedder (isolate FTS)
  // Tier 1: relational invariants — every `above` slug must outrank its `below`.
  rankedAbove?: [above: string, below: string][];
  // Tier 1: hard visibility — these slugs must NEVER appear.
  mustNotContain?: string[];
  // Tier 2: these slugs appear, in this relative order.
  orderedSubset?: string[];
  // Tier 3: exact full ordering of the first page.
  exactOrder?: string[];
  expectPartial?: boolean; // I9 degraded mode
}

export const FIXTURE_USERS: FixtureUser[] = [
  { key: "viewer", id: "fx-user-viewer", name: "Vy Viewer", email: "viewer@fixture.test", handle: "viewer" },
  { key: "friend", id: "fx-user-friend", name: "Fred Friend", email: "friend@fixture.test", handle: "friend" },
  { key: "stranger", id: "fx-user-stranger", name: "Stan Stranger", email: "stranger@fixture.test", handle: "stranger" },
];

export const FIXTURE_TAGS = ["zephyrium", "gardening", "rust-lang"] as const;
export const FIXTURE_CATEGORIES: { name: string; displayName: string }[] = [
  { name: "quokkanet", displayName: "Quokka Networking" },
  { name: "cooking", displayName: "Cooking" },
];

// Helper for ISO dates; explicit so ordering is deterministic.
const d = (n: number) => `2026-01-${String(n).padStart(2, "0")}T00:00:00.000Z`;

export const FIXTURE_POSTS: FixturePost[] = [
  // --- I1 field-weight matched set: same probe term in different fields. ---
  // Body-only is NEWEST so pre-fix (all weight D) it wins on recency tiebreak.
  { slug: "fw-title", ownerKey: "viewer", title: "Zephyrium handbook", excerpt: "Unrelated summary.", content: "Body without the probe.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(1) },
  { slug: "fw-excerpt", ownerKey: "viewer", title: "Unrelated title", excerpt: "A note about zephyrium.", content: "Body without the probe.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(2) },
  { slug: "fw-body", ownerKey: "viewer", title: "Unrelated title", excerpt: "Unrelated summary.", content: "Deep in the body we mention zephyrium once.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(9) },

  // --- I11 tag/category-only match for the same probe term. ---
  { slug: "tag-only", ownerKey: "viewer", title: "Tagged item", excerpt: "Summary.", content: "Body text.", type: "FINDING", status: "PUBLISHED", visibility: "PRIVATE", tags: ["zephyrium"], categories: [], createdAtIso: d(3) },

  // --- I4 more-terms-match > fewer. Query "rust OR gardening". ---
  { slug: "both-terms", ownerKey: "viewer", title: "Rust and gardening together", excerpt: "On rust and gardening.", content: "Discussion of rust and gardening.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: ["rust-lang", "gardening"], categories: [], createdAtIso: d(4) },
  { slug: "one-term", ownerKey: "viewer", title: "Just gardening", excerpt: "Only gardening here.", content: "All about gardening, nothing else.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: ["gardening"], categories: [], createdAtIso: d(5) },

  // --- I5 phrase/proximity. Query "\"quokka networking\"". ---
  { slug: "phrase-hit", ownerKey: "viewer", title: "Quokka networking explained", excerpt: "quokka networking guide", content: "The phrase quokka networking appears contiguously.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(6) },
  { slug: "phrase-scattered", ownerKey: "viewer", title: "Notes", excerpt: "Scattered.", content: "Quokka care is fun. Networking events are great.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(7) },

  // --- I7 visibility: posts the viewer must NEVER see. ---
  { slug: "stranger-private", ownerKey: "stranger", title: "Zephyrium secret", excerpt: "Private zephyrium.", content: "zephyrium zephyrium zephyrium.", type: "BLOG", status: "PUBLISHED", visibility: "PRIVATE", tags: ["zephyrium"], categories: [], createdAtIso: d(8) },
  { slug: "stranger-public", ownerKey: "stranger", title: "Public zephyrium notes", excerpt: "Public.", content: "zephyrium in public.", type: "BLOG", status: "PUBLISHED", visibility: "PUBLIC", tags: [], categories: [], createdAtIso: d(8) },
  { slug: "friend-friends-pub", ownerKey: "friend", title: "Friendly zephyrium", excerpt: "Friends only.", content: "zephyrium among friends.", type: "BLOG", status: "PUBLISHED", visibility: "FRIENDS", tags: [], categories: [], createdAtIso: d(8) },
  { slug: "friend-friends-draft", ownerKey: "friend", title: "Draft zephyrium", excerpt: "Draft.", content: "zephyrium draft.", type: "BLOG", status: "DRAFT", visibility: "FRIENDS", tags: [], categories: [], createdAtIso: d(8) },

  // --- I10 owner finds own DRAFT. ---
  { slug: "viewer-draft", ownerKey: "viewer", title: "My zephyrium draft", excerpt: "Draft.", content: "zephyrium draft of mine.", type: "BLOG", status: "DRAFT", visibility: "PRIVATE", tags: [], categories: [], createdAtIso: d(8) },
];

export const GOLDEN_QUERIES: GoldenQuery[] = [
  {
    name: "field-weight: title > excerpt > body (FTS-isolated)",
    query: "zephyrium", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    rankedAbove: [["fw-title", "fw-excerpt"], ["fw-excerpt", "fw-body"]],
  },
  {
    name: "tag match outranks body-only, below title",
    query: "zephyrium", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    rankedAbove: [["fw-title", "tag-only"], ["tag-only", "fw-body"]],
  },
  {
    // OR semantics: space-separated terms become AND in websearch_to_tsquery,
    // which would EXCLUDE one-term (no "rust") entirely. The "more matched terms
    // rank higher" invariant only manifests when both posts can appear, i.e.
    // under an explicit OR (a supported websearch operator).
    name: "more terms matched ranks higher",
    query: "rust OR gardening", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    rankedAbove: [["both-terms", "one-term"]],
  },
  {
    name: "phrase proximity beats scattered terms",
    query: "\"quokka networking\"", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    mustNotContain: ["phrase-scattered"], orderedSubset: ["phrase-hit"],
  },
  {
    name: "visibility never-leak for stranger/friend-draft (scope=all)",
    query: "zephyrium", viewerKey: "viewer", scope: "all", mode: "fts-only",
    mustNotContain: ["stranger-private", "friend-friends-draft"],
  },
  {
    name: "friend FRIENDS + stranger PUBLIC are visible (scope=all)",
    query: "zephyrium", viewerKey: "viewer", scope: "all", mode: "fts-only",
    orderedSubset: ["friend-friends-pub"],
  },
  {
    name: "owner finds own draft (scope=mine)",
    query: "zephyrium", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    orderedSubset: ["viewer-draft"],
  },
  {
    name: "empty query returns nothing",
    query: "   ", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    exactOrder: [],
  },
  {
    name: "degraded mode is partial + FTS-only",
    query: "zephyrium", viewerKey: "viewer", scope: "mine", mode: "fts-only",
    expectPartial: true, orderedSubset: ["fw-title"],
  },
];
