# HANDOFF — Sirius (sirius-2-simple)

Stitch redesign + real features + Cache Components. Keep this file updated each loop iteration; it is the baton for the next agent.

**Date:** 2026-05-29 · **Branch:** `main` · **User:** saleebm · **Last commit:** `e66aa5f feat(web): Sirius redesign …`

## Standing rule (this loop)

Keep the plan written down, refresh THIS `HANDOFF.md` each iteration, and **leverage the USER for testing** — do not self-verify behavior in a browser or assume features work. The user tests and reports; the agent reacts.

## Where we are

- **Redesign (6 phases + PostImage consolidation): COMMITTED** as `e66aa5f` on `main` (local, not pushed). User browser-tested it ("looks good"). Gates green: `check-types` 7/7, `build` PPR, `lint` 5/5.
- **Worker crash-resilience — COMMITTED** as `6387d5e` (local, not pushed). `reclaimStaleProcessing` (ingest.ts), `findPostBySourceRecordId` (posts.ts read), `force` column + migration `add_ingest_force`, reclaim-at-startup+per-tick & idempotency short-circuit (worker `index.ts`), env `INGEST_LEASE_MS`/`INGEST_MAX_ATTEMPTS` (turbo.json). `check-types` 7/7, `lint` 5/5. **Runtime-verified ✅** — deterministic test (since removed) passed 6/6: stale rows requeue, exhausted ones dead-letter, fresh untouched, `findPostBySourceRecordId` match/null; reclaim also recovered a _real_ row stranded by an earlier kill.
- **Follow-ups DONE (gates green, local):** (1) `force` flag wired end-to-end — composer checkbox already existed; now `createSubmission`/`submitUrlIngest` persist it to the `force` column so the worker's idempotency guard honors it. (2) Worker **heartbeat** — `heartbeatProcessing(ids)` (ingest.ts) bumps `startedAt`; `processBatch` runs it on an interval (`leaseMs/3`, min 5s) during the pipeline so long jobs aren't falsely reclaimed. No new migration (`force` column shipped in `6387d5e`).
- **Dev stack: WOUND DOWN** (user request) — loop cron `b27d886e` CANCELLED; no worker/web/docs/metro; all ports free. Restart with `bun dev`, or `turbo run dev --filter=!worker` if running a worker separately.

## Source of truth

- **Redesign plan (done/committed):** `/Users/minasaleeb/.claude/plans/streamed-churning-wigderson.md`.
- **Current plan (worker resilience):** `/Users/minasaleeb/.claude/plans/elegant-frolicking-pony.md` — APPROVED, implementing. Adds: `force` col on `IngestSubmission` (migration `add_ingest_force`), `reclaimStaleProcessing` in `ingest.ts`, `findPostBySourceRecordId` (read) in `posts.ts`, reclaim+idempotency in `apps/worker/src/index.ts`, env `INGEST_LEASE_MS`/`INGEST_MAX_ATTEMPTS` in `turbo.json`. Respects "posts.ts query-only" (read only there; write in ingest.ts).

## What changed (by phase → files)

- **P1 Library pagination:** `packages/db/src/posts.ts` (`buildPostWhere`, `listPostsPage`, `countPosts`); `app/(app)/library/{page,filters}.tsx`; new `library/pagination.tsx`; removed `/library`→`/catalog` redirect in `next.config.js`.
- **P2 Post-detail:** new `app/(app)/posts/[slug]/{colophon-tabs,share-button}.tsx` (Details / History-provenance / Analytics tabs + featured image); `posts/[slug]/page.tsx`.
- **P3 Save:** `SavedPost` model + migration `20260529042018_add_saved_post`; `packages/db/src/saved.ts`; `api/app/posts/[slug]/save/route.ts`; `save-button.tsx`.
- **P4 Analytics:** `PostView` model + migration `20260529042218_add_post_view`; `packages/db/src/analytics.ts`; `view-beacon.tsx`; `api/app/posts/[slug]/view/route.ts` (owner self-views excluded).
- **P5 Export:** `api/app/posts/[slug]/export/route.ts` (JSON + Markdown).
- **P6 Cache Components:** `cacheComponents: true`; all `force-dynamic` removed; both layouts = static shell + Suspense'd chrome/gate; `lib/session.ts` memoized w/ React `cache()`; new `lib/cached.ts` (`use cache` + `cacheTag`/`cacheLife`); `api/internal/revalidate/route.ts` + worker `apps/worker/src/lib/revalidate.ts` (called from `post-writer.ts`). **Unified nav** → `app/_chrome/site-nav.tsx` (old `(app)/_chrome/nav.tsx` + `(public)/_chrome/public-nav.tsx` deleted).
- `turbo.json`: declared `BETTER_AUTH_URL`, `REVALIDATE_TOKEN`, `WEB_REVALIDATE_URL`. Pre-existing lint fixed (entity escaping; mobile `use-color-scheme.web.ts` → `useSyncExternalStore`).
- **Image consolidation (post-`/btw`):** new `app/_chrome/post-image.tsx` is the single source for post cover images — rendered as a `fill` child inside a caller-owned aspect box; `unoptimized={!isLocal}` (so arbitrary remote hosts can't 403 the optimizer — this fixed the broken non-local image on `/posts/[slug]`); `onError` → "No plate" fallback. All four image sites use it: `catalog/page.tsx`, `catalog/[handle]/page.tsx`, `listing/[slug]/page.tsx`, `posts/[slug]/page.tsx`. Only `post-image.tsx` imports `next/image`. Green: check-types + lint ✅.

## Repo orientation (read first)

| Path                                                                     | Why                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `~/.claude/plans/streamed-churning-wigderson.md`                         | Approved plan                                                  |
| `apps/web/lib/cached.ts`                                                 | `use cache` wrappers + tag/lifetime scheme                     |
| `apps/web/app/(app)/layout.tsx`, `(public)/layout.tsx`                   | PPR static-shell + Suspense pattern to mirror                  |
| `apps/web/app/_chrome/site-nav.tsx`                                      | Single nav source (SIGNED_IN_NAV / SIGNED_OUT_NAV)             |
| `packages/db/src/posts.ts`                                               | Query-only by contract; NEW WRITES → `saved.ts`/`analytics.ts` |
| `api/internal/revalidate/route.ts` + `apps/worker/src/lib/revalidate.ts` | Cross-app cache invalidation                                   |

## Live systems

- Web: `bun dev` → http://localhost:3000. Postgres `sirius-2-simple` @ localhost:5432 (`DATABASE_URL`, `.env` symlinked from root). `bun db:studio` to inspect.
- Worker: `bun worker:dev` — polls `IngestSubmission`, writes posts via `prisma.post.upsert` in `post-writer.ts`.
- Migrations: run inside `packages/db` via `bunx prisma migrate dev` (turbo/bun mangle the `--name` flag; invoke prisma directly in the package). Two migrations already applied.

## Open items

1. **Redesign committed** (`e66aa5f`, local only). Push/PR when the user wants it off-machine.
2. **Set env for live invalidation:** `REVALIDATE_TOKEN` (web + worker), `WEB_REVALIDATE_URL` (worker). User said these are set on their side.
3. **Worker resilience (in flight):** implement per `elegant-frolicking-pony.md`; then run migration `add_ingest_force` + `bun check-types`/`bun lint`. **USER-driven runtime test (do NOT self-verify):** submit an ingest, `kill -9` the worker mid-`processing`, restart → expect `reclaim requeued:1` and completion; idempotent-skip on re-run; dead-letter after 3.
4. **Duplicate-worker note:** plain `bun dev` starts a 2nd worker alongside the user's standalone one. Run the stack via `turbo run dev --filter=!worker` so the user's worker stays the only one. (Web dev was stopped mid-restart; bring up filtered.)
5. Untracked `CLAUDE.md` + `.claude/` at repo root were not authored this session — left out of the commit; confirm before touching.

## Hard rules (user global CLAUDE.md)

- Never do something other than agreed — **ASK when unsure**; don't assume.
- See a failure (even pre-existing) → flag it, propose, ask before fixing out-of-scope.
- Editorial paper-and-ink aesthetic only; borrow Stitch _structure_, never its dark theme.
- `posts.ts` is query-only; writes in dedicated files.

## Suggested skills

- `run` / `verify` — to help the USER launch the app for THEIR testing (not to self-confirm).
- `code-review` / `pr-review-toolkit:review-pr` — before committing the large diff.
- `commit-commands:commit-push-pr` — once the user approves.
- `next-cache-components` — when extending `use cache` / Suspense.

## What NOT to redo

Don't re-plan (plan approved). Don't re-add `force-dynamic` (breaks cacheComponents) or the `/library` redirect. Don't move writes into `posts.ts`. Don't apply the dark Stitch theme. Don't re-fix lint (green). Don't re-run migrations (applied).

## Loop

Cron `b27d886e` — every 10 min, prompt: "plan must written down /handoff always to next and leverage me testing". Session-only, auto-expires 7 days. Cancel: CronDelete `b27d886e`.
