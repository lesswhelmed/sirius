# HANDOFF — Ingest orphans path-named `Category` rows

## TL;DR

Every ingest leaves dangling, **post-less `Category` rows keyed by the full
slash-path** (e.g. `lifestyle/beekeeping`, `science/biology`, `science/botany`).
`writePost` creates flat `Category` rows from the model's **raw path strings**
and links the post to them; the classification step then **relinks the post to
canonical leaf names** (`beekeeping`, `biology`) and never cleans up the
path-named rows it orphaned. The `Category` table grows monotonically with junk.

Fix it, add a one-off cleanup for existing orphans, and verify the table count is
stable across an ingest.

## How it was found (repro)

1. Baseline: `SELECT count(*) FROM "Category"` → **109**; none named `beekeeping`/`biology`.
2. Submitted a note via the web composer ("Morning at the Apiary", a beekeeping note).
3. Worker drafted a BLOG post; submission → `completed`.
4. After: count → **113 (+4)**, but the post carries only **2** categories.

```
NEW_CATEGORIES = ["beekeeping", "biology", "lifestyle/beekeeping", "science/biology"]
  beekeeping            posts=1   ✅ canonical leaf, linked to the post
  biology               posts=1   ✅ canonical leaf, linked to the post
  lifestyle/beekeeping  posts=0   ⚠️ ORPHAN (path-named, created by writePost, then unlinked)
  science/biology       posts=0   ⚠️ ORPHAN
```

`science/botany` in the original 109 is the same artifact from a prior ingest, so
this has been happening for a while.

## Root cause (exact code path)

The pipeline runs `writePost` then `assignOrg` (`apps/worker/src/pipeline/pipeline.ts:54` and `:69`).

1. **`writePost` creates flat Category rows from the RAW proposed paths.**
   `apps/worker/src/pipeline/post-writer.ts:258-281` builds `categoryConnects`
   with `where:{ name }, create:{ name, displayName, slug }` where `name` is the
   **full path string** from `frontmatter.categories` (the draft schema in
   `packages/ingest-draft/src/index.ts:29-35` says categories are
   slash-delimited paths like `lifestyle/beekeeping`). These are attached via
   `categories: { connectOrCreate: categoryConnects }` on both the create and
   update branches (`post-writer.ts:350`, `:371`). `slugifyTaxonomy` strips the
   `/`, but the `name` keeps the slash verbatim.

2. **`assignOrg` relinks the post to canonical LEAF names, orphaning step 1's rows.**
   `apps/worker/src/pipeline/classification/assign-org.ts:213` calls
   `resolveCategoryPaths(...)`, which returns `ResolvedTopic[]` whose `name` is
   the **resolved leaf segment** (`resolve-categories.ts:270`,
   `name = plan.leafPath.split("/").pop()`). Then `assign-org.ts:240` calls
   `setPostCategories(postId, topics.map(t => t.name))`
   (`packages/db/src/categories.ts:34-59`), which does
   `categories: { set: [], connectOrCreate: <leaf names> }` — the `set: []`
   **unlinks every prior link**, including the path-named rows from step 1, which
   then have zero posts and are never deleted.

The `categories.ts` header comment already documents the *intended* reconcile
("post-writer creates these from the raw model output; the category resolver
later reconciles ... to the CANONICAL leaf names") — leaving orphans is an
unintended side effect of that seam, not a deliberate design.

Note: `CategoryEmbedding` (the dynamic taxonomy, `resolve-categories.ts:246
upsertCategoryEmbedding`) is a **separate table** and is fine. This bug is only
about the flat `Category` (post-label) table.

## Desired fix

Two complementary changes (the chosen direction is "stop writePost creating raw-path
rows" **and** "have the resolver prune after relink" — do both; they cover the
common case and the residual synonym case respectively):

1. **`writePost` should create flat categories by LEAF segment, not full path.**
   In `post-writer.ts`, derive each category name as the last path segment
   (`name.split("/").pop()`) before building `categoryConnects` (keep the existing
   `dedupeByName`, `slugifyTaxonomy`, `titleCase`). This makes the fallback labels
   sensible (`beekeeping`, not `lifestyle/beekeeping`) AND makes them match what
   the resolver reconciles to — so the common (non-synonym) case produces **no
   orphan at all** (the resolve step reuses the same row).
   - Keep writePost creating categories: `assignOrg` is best-effort/non-fatal and
     is **skipped when classification is disabled or the resolver throws**
     (`assign-org.ts:211-220, 238`), so the flat rows writePost makes are the
     only categories in that path. Do **not** simply delete writePost's category
     creation.

2. **Prune orphaned flat categories after the reconcile.** Add a helper in
   `packages/db/src/categories.ts` (e.g. `deleteOrphanCategories()` →
   `prisma.category.deleteMany({ where: { posts: { none: {} } } })`) and call it
   right after the successful `setPostCategories(...)` in `assign-org.ts:240-249`,
   inside the same non-fatal try/catch. This is **safe**: a flat `Category` only
   exists to label posts, and a row always has ≥1 post the instant it's created
   (writePost's `connectOrCreate` creates+links atomically), so a 0-post row can
   only arise *after* an unlink. It also self-heals the synonym case (when the
   resolver canonicalizes `beekeeping` → an existing `apiculture` node, writePost's
   `beekeeping` row would orphan; the prune removes it).

3. **One-off cleanup of the existing orphans.** A small script (e.g.
   `apps/worker/scripts/cleanup-orphan-categories.ts`, runnable via
   `bun run apps/worker/scripts/cleanup-orphan-categories.ts`) that deletes all
   `Category` with no posts and logs how many it removed. Run it once; expect it to
   remove `lifestyle/beekeeping`, `science/biology`, `science/botany`, and any
   other path-named 0-post rows. Do **not** add it as an auto-migration without
   asking.

## Tests / verification (no test runner is wired into CI — use `bun test` directly)

- Extend `apps/worker/src/pipeline/post-writer.test.ts` (the existing black-box
  mocked unit test): assert that a draft category of `lifestyle/beekeeping`
  produces a `connectOrCreate` with `where.name === "beekeeping"` (leaf), not the
  full path. Run with `cd apps/worker && bun test`.
- If you add `deleteOrphanCategories`, a focused test is nice-to-have but a DB
  unit test needs mocking — match the mocked style already in
  `post-writer.test.ts` (it stubs `@repo/db` by spreading the real module and
  overriding only the prisma method it needs).
- **End-to-end gate:** with the dev stack up (`bun run dev`, portless on :443 →
  `https://sirius.local`), record `Category` count, submit one note ingest, wait
  for `completed`, and assert the count delta equals exactly the number of NEW
  canonical leaf categories on that post (0 if all reused) — **no path-named
  rows**. There is a ready DB-probe pattern: `cd apps/worker && bun -e "import
  {prisma} from '@repo/db'; ..."`.

## Constraints / guardrails (from the repo owner)

- Do **not** change committed config or behavior beyond this bug without asking.
- `lint` must pass with `--max-warnings 0`; `check-types` requires `db:generate`
  first.
- Don't commit — surface the diff for review.
- The `Category.name` and `Category.slug` columns are both `@unique`
  (`packages/db/prisma/schema.prisma:96-105`). Leaf-name collisions across
  different paths are expected and fine (that's the dedup intent); just make sure
  `connectOrCreate` matches on `name`.

## Key files

- `apps/worker/src/pipeline/post-writer.ts:258-281, 350, 371` — flat Category creation (fix #1 here)
- `apps/worker/src/pipeline/classification/assign-org.ts:211-249` — resolve + reconcile (call prune here, fix #2)
- `packages/db/src/categories.ts:34-59` — `setPostCategories` (add `deleteOrphanCategories` here)
- `apps/worker/src/pipeline/classification/resolve-categories.ts:186-280` — canonical leaf naming (context, no change expected)
- `apps/worker/src/pipeline/post-writer.test.ts` — extend the unit test
- `packages/ingest-draft/src/index.ts:29-35` — draft schema (categories are paths; context)
