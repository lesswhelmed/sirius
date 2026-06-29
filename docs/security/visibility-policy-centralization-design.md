# Design: Centralize the public-tier visibility policy

**Status:** Proposed (not yet implemented) — awaiting review.
**Origin:** Findings 1 & 2 of `post-visibility-audit-2026-06-29.md`.

## Problem

`apps/web/lib/features.ts` asserts that `canReadPost` is "the ONLY place the [read] policy
is applied — nothing else should hardcode it." That invariant is not enforced — it was
violated in three places, all concerning the **public tier**:

1. The catalog/storefront list helpers (`listCatalogPosts`, `listUserStorefront`) filtered
   on `status` only.
2. The `/listing/[slug]` page's anonymous fast-path gated on `status` only.
3. `searchCorpus` derived `includePublic` from `scope`, never from the flag.

The tactical fixes (already shipped) close the leaks, but the *structural* weakness remains:
the public-tier decision is spread across `canReadPost`, the list builders, and search, and
there are **two** intended flags (`PUBLIC_CATALOG_ENABLED` for signed-in cross-user reads,
`ANONYMOUS_CATALOG_ENABLED` for logged-out reads) of which the second is dead code. Any new
list/feed/search/export surface can re-introduce the same divergence.

## Goal

One module that answers "is the public tier readable, and to whom?" so that `canReadPost`,
every list WHERE-builder, and search all consume the *same* decision. No surface hardcodes a
flag; the anonymous gate is genuinely stricter than the signed-in gate.

## Approach (recommended)

A single policy module in `@repo/db` (so both the web app and the DB helpers can import it
without a cross-app dependency), e.g. `packages/db/src/visibility-policy.ts`:

```ts
export type ViewerKind = "anonymous" | "authenticated";

export interface PublicTierPolicy {
  // PUBLIC posts readable by a signed-in non-owner.
  signedInPublic: boolean;
  // PUBLIC posts readable with no session at all (⊆ signedInPublic).
  anonymousPublic: boolean;
}

// Pure: given the two flags, produce the effective policy with the invariant
// anonymousPublic ⇒ signedInPublic enforced in one place.
export function publicTierPolicy(flags: {
  publicCatalogEnabled: boolean;
  anonymousCatalogEnabled: boolean;
}): PublicTierPolicy;
```

The flags still live in web `features.ts` (their values are a deployment concern), but the
*derivation* and the `anonymous ⊆ signedIn` invariant live in one pure function. Each
consumer is refactored to take a `PublicTierPolicy` (or a viewer-kind + policy) instead of
reading a raw boolean:

- `canReadPost(post, viewerId, policy)` — PUBLIC tier branches on `viewerId == null ? policy.anonymousPublic : policy.signedInPublic`. This closes the latent gap where `canReadPost`'s PUBLIC tier didn't distinguish anonymous from signed-in.
- `visibilityWhereForViewer` / `searchVisibilityWhere` — take `includePublic` derived from the policy + viewer kind, not from `scope`.
- `listCatalogPosts` / `listUserStorefront` — keep the `visibility: PUBLIC` filter (defense in depth) *and* the caller passes the policy so the surface renders only when `anonymousPublic` is true.
- The `/listing/[slug]` page computes viewer kind from the session and consults the policy.

### Why not the alternatives

- **Leave it as-is (just the tactical fixes).** Closes today's leaks but not the class — the next surface can diverge again, and `ANONYMOUS_CATALOG_ENABLED` stays dead.
- **Put the policy in web only.** `@repo/db`'s list/search builders need it too, and they can't import web code. The policy must live in `@repo/db`.
- **A runtime config object threaded everywhere.** Heavier than needed; a pure function over two booleans is enough and is trivially testable.

## Testing

- Unit-test `publicTierPolicy` for the four flag combinations and the `anonymous ⊆ signedIn` invariant.
- Extend the search golden matrix (already has flag-on/flag-off cases) with an anonymous-viewer case once the policy threads viewer-kind.
- A small `canReadPost` table test: {owner, friend, group-member, stranger-signed-in, anonymous} × {PRIVATE, FRIENDS, GROUP, PUBLIC} × {both flags} — proving every cell matches the policy.

## Scope / sequencing

This is a focused refactor, not a feature. It touches `canReadPost` and the four builders
plus their call sites. Recommend doing it as one plan after the tactical fixes land, with the
table test written first (it will pass for the already-fixed behavior and lock it in).

## Out of scope

The LOW findings (3–5) and the `bio` product decision (6) are tracked separately as beads;
they are not part of this centralization.
