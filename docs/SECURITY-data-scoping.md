# Data scoping & per-user isolation

This is the invariant that keeps one user from seeing another user's private
data. It exists because the signed-in **Queue** (and the posts list + single-post
reads) once returned **every** user's rows — they authenticated the caller but
never filtered by the caller's id. This doc is the contract; treat a violation as
a security bug, not a UI nit.

## The invariant

> Every read on the session-authed surface — any `apps/web/app/api/app/**`
> route and any `apps/web/app/(app)/**` server component — must filter by the
> **current session user id**. The only data one user may see from another is a
> **`PUBLISHED` `SOCIAL`** post, and that is served exclusively from the
> **`(public)`** route group (`/catalog` signed-out, `/catalog/[handle]`,
> `/listing/[slug]`).

Corollaries:

- **Bearer-token ingest routes** (`/api/ingest`, `/api/ingest-images`) carry no
  user attribution by design — they're for Shortcuts/scripts. They are write-only
  intake; they never read another user's data back.
- **The worker** legitimately reads all rows (it's the queue consumer). It is not
  on the session-authed surface.

## How scoping is enforced (reuse these — don't re-invent)

### 1. Owner id is a *required* parameter on private list helpers

`@repo/db` helpers that back the cockpit take the owner id as a **required**
positional arg, so a caller physically cannot forget to scope:

- `listSubmissions(submittedById, opts)` — `packages/db/src/ingest.ts`
- `listOwnerPosts(ownerId, opts)` — `packages/db/src/posts.ts` (wraps the
  low-level `listPosts`; the public catalog/storefront helpers
  `listCatalogPosts` / `listUserStorefront` keep using `listPosts` with their own
  explicit, intentionally-public filters)
- `listProjects(ownerId, opts)`, `listAspirations(ownerId, opts)`,
  `getProject(userId, id)`, `updateProject(userId, id)`, … —
  `packages/db/src/projects.ts`
- `listArchiveRequests(userId)` — `packages/db/src/archive.ts`
- `listPostsChangedSince({ ownerId, since })` — `packages/db/src/posts.ts`
- `getEmbeddingSceneRows(ownerId)` — `packages/db/src/embeddings.ts`

`listPosts(opts)` and `findPostBySlug(slug)` are **low-level / global** building
blocks. Do not call them directly from a session-authed route without scoping —
use `listOwnerPosts` for lists and `canReadPost` (below) to gate single reads.

### 2. Single-post READ access has ONE policy function

`apps/web/lib/post-access.ts` → `canReadPost(post, viewerId)` is the **single
source of truth** for "may this viewer read this one post." Today the rule is
owner-only; it is `async` and has explicit extension points so sharing /
org-visibility can be added **there and nowhere else**. Every cockpit single-post
read funnels through it:

- `GET /api/app/posts/[slug]`
- `GET /api/app/posts/[slug]/export`
- the `(app)/posts/[slug]` page

Denials return **404, not 403**, so a non-owner can't probe which slugs exist.
Owner-only **mutations** (delete, assign-to-project, download source originals)
keep their own `post.submittedById === viewerId` checks — sharing a post for
reading must never grant write/management rights.

### 3. Categories (Tree / Observatory) are owner-scoped by derivation

`CategoryEmbedding` is a **global** table (no `ownerId`): a fixed `seed`
analysis-facet taxonomy plus `dynamic` topic nodes grown from content at ingest.
A dynamic node can exist only because *another* user ingested that topic, so the
scene must not show the raw global set. `getEmbeddingSceneRows(ownerId)` keeps
only the category nodes the owner's **own** posts match (via their
`categoryMatches`), walked up `parentPath` to the root so the tree stays
connected. Posts and projects in the scene are already `where: { ownerId }`.

## Checklist — adding a new `/api/app/*` route or `(app)` page

1. Get the session: `const session = await getSessionOrNull()` (route) /
   `requireSession()` (page). Return 401 / redirect when absent.
2. For every DB read, pass `session.user.id` into an owner-scoped helper. If no
   such helper exists, **add one with the owner id as a required arg** — don't
   inline an unscoped `prisma.*.findMany`.
3. For a single resource fetched by slug/id, gate it through `canReadPost`
   (posts) or an ownership check (`where: { id, ownerId }` / compare the loaded
   owner field). Deny with 404.
4. Never return another user's rows except `PUBLISHED` `SOCIAL` posts from
   `(public)`.
5. Run the guardrail (below).

## Guardrail

`scripts/testing/scoping-audit.sh` seeds two A-owned marker rows, signs in as a
second user **B**, and asserts B's session sees none of A's rows via
`/api/app/queue` and `/api/app/posts`, and gets **404** on A's post +
`…/export`. Run it after touching any `(app)` route or a `@repo/db` read helper:

```sh
# one-time: add a second user's creds to scripts/testing/.creds.local
#   TEST_EMAIL_B=... / TEST_PASSWORD_B=...   (bootstrap a second verified user)
./scripts/testing/scoping-audit.sh
```

It does **not** assert the embedding-scene category scoping (that needs a full
embedding fixture). That path is covered by the required-`ownerId` signature of
`getEmbeddingSceneRows` and its in-code derivation; if you change it, re-read
section 3 above.
