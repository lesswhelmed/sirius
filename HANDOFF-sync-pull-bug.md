# HANDOFF — mobile offline-sync delta pull fails (`InvalidConvertibleException`) + embedding-sync fix context

Date: 2026-06-19. Author: prior agent session (driving the iOS sim). Branch: `main`.
(Separate from the existing `HANDOFF.md` baton — do not touch that one.)

## TL;DR for the sub-agent

There are **two** issues. One is **fixed** (embedding sync), one is your job:

1. **FIXED (do not redo, just understand):** on-device "ask my posts" found nothing because
   post embeddings never reached the device. Root cause: `upsertPostEmbedding`
   (`packages/db/src/embeddings.ts`) didn't bump `Post.updatedAt`, so the `updatedAt`-cursored
   mobile delta feed never re-delivered a post once its (later-written) embedding landed. Fix
   applied: touch `Post.updatedAt` (raw SQL, NOT `lastEdited` which is user-facing) atomically
   with the embedding upsert, + bump mobile `SINCE_KEY` v2→v3 for a one-time backfill re-pull.
   Verified at the DB layer (updatedAt bumps, lastEdited preserved). NOT yet validated
   end-to-end on device because of issue #2.

2. **YOUR TASK — the blocker:** the mobile delta pull throws on EVERY pull (posts AND comments),
   so nothing syncs, the since-cursor never advances, and vectors can't land. Fix this, then
   validate the embedding fix end-to-end (below).

## Evidence for issue #2 (from Metro log `apps/mobile/.expo/dev/logs/start.log`)

```
[sync] pull (cold-start) failed: Error: Calling the 'runAsync' function has failed → Caused by: undefined reason
[sync] comment pull (cold-start) failed: FunctionCallException: Calling the 'runSync' function has failed
   (at ExpoModulesCore/SyncFunctionDefinition.swift:94)
   → Caused by: InvalidConvertibleException: undefined reason (at ExpoSQLite/SQLiteModule.swift:649)
```

- Fires on `pull` (posts) AND `comment pull` — comments have NO vectors, so this is NOT the
  vector code; it's a **shared offline-sync write bug**.
- Pre-existing in committed code (timestamps predate this session's edits; sync files last
  touched in commit `7c1f3c1` "werk" / earlier — NOT by this session).
- `InvalidConvertibleException` = expo-sqlite was handed an **`undefined`** bound parameter
  (JS `null` binds fine; `undefined` does not).

## Prime suspect + desired solution

The reconcile mappers bind nullable wire fields straight through drizzle. If the server delta
**omits** any field, the client reads `undefined` (not `null`) → bind throws.

- `apps/mobile/src/lib/sync/comment-reconcile.ts` — `reconcileCommentUpsert` builds `mirrored`
  with `authorId / authorLabel / authorImage / authorKind` and `.set(mirrored)` /
  `.insert().values(...)`. Wire type `CommentDelta` (`events.ts`) marks these `string | null`,
  but the SERVER contract is `packages/db/src/comments.ts` (`listCommentsChangedSince` /
  `CommentDelta`). If the server doesn't actually emit one of them, it's `undefined` on device.
- `apps/mobile/src/lib/sync/reconcile.ts` — the post drizzle insert/update path; nullable
  fields `images / contentDigest / sourceRecordId / excerpt / imageUrl`, and note `providerId`
  is typed non-null in `events.ts` but may be null/absent for older posts. (The vector path
  `mirrorPostVector` → `vector-store.ts:80` raw `runAsync` is also a candidate for the POST
  pull's `runAsync` failure — check it too, but it can't explain the comment failure.)

### Steps

1. Reproduce: with the stack up (`bun run dev` running; web 200 at https://sirius.local, Metro
   on 8081, iPhone 17 Pro sim booted, app `dev.copt.sirius`, logged in as
   `saleebmina@icloud.com` — password is `DEV_LOGIN_PASSWORD` in root `.env`), foreground the
   app and watch the Metro log — the pull fails on cold-start/foreground/nudge.
2. Pinpoint WHICH field is `undefined`: compare each mobile wire type in `events.ts` against the
   actual server payload shape in `packages/db/src/posts.ts` (`listPostsChangedSince`) and
   `packages/db/src/comments.ts` (`listCommentsChangedSince`). Find the field the server omits
   (or sends `undefined`) that the client binds. A targeted way: log the first failing row's
   keys in the reconcile mapper, or curl the changes feed with a valid session cookie.
3. **Determine local-only vs production:** is this device-DB-state (a missing on-device
   migration / schema drift) or a genuine code bug that also breaks production devices? This
   gates deployment urgency — REPORT it explicitly.
4. Fix at the right layer:
   - Preferred: make the server delta always emit the field (coalesce to `null`), AND/OR
   - Defensive in the reconcile mappers: coalesce every nullable field `?? null` before binding
     (so an omitted/`undefined` field can never crash the whole pull).
   - Whatever you change, a single bad row must not abort the entire pull silently.
5. Keep it minimal and idiomatic; match surrounding code. Run `bunx tsc --noEmit` and
   `bunx eslint <files> --max-warnings 0` in `apps/mobile` (and `packages/db` if touched).

## Validate the embedding fix end-to-end (after #2 is fixed)

The blackbox bench is already wired (this session). Use it:

1. Reload/relaunch the app so the v3 `SINCE_KEY` bundle loads → it does a full re-pull from
   EPOCH; with #2 fixed, posts apply and `reconcile.mirrorPostVector` writes `post_vectors`.
2. Run the self-retrieval bench: deep-link `dev.copt.sirius://llm-test`, tap **Run post search**
   (or `?run=search`). Expect `self-retrieval` PASS (was `0/3 found by their own title`).
3. Run the full chat flow: tap **Run ask-my-posts flow** (or `?run=ask`). Expect each `ask:`
   check PASS with `>0 sources` (was `0 sources`); `decide-routes-to-search` already passes.
4. Confirm via Metro log lines `[llm-test] {"id":"post-search",...}` and `{"id":"ask-flow",...}`
   show `"ok":true`.

agent-device notes: reuse `--session s1`; the runner breadcrumb re-foregrounds (re-`open
dev.copt.sirius` after deep links); `metro reload` has been returning 500 — use
`open ... --relaunch` to force a fresh JS bundle.

## Files changed this session (the embedding fix — already applied, do NOT revert)

- `packages/db/src/embeddings.ts` — `upsertPostEmbedding` now touches `Post.updatedAt` (raw SQL).
- `apps/mobile/src/lib/sync/changes-pull.ts` — `SINCE_KEY` v2 → v3.
- Bench (no behavior change to prod): `apps/mobile/src/lib/research/ask.ts` (+`onDecision`),
  `apps/mobile/src/lib/llm/test-bench.ts` (`runAskFlowTest`), `apps/mobile/src/app/llm-test.tsx`.

## Deployment note (from the user, for LATER — do not deploy yet)

The embedding fix must roll out through the prod pipeline "properly and safely": get the process
right and fully test locally BEFORE applying to deployment. Relevant: fix #1 changes a shared
`@repo/db` helper the worker uses in prod; the v3 `SINCE_KEY` forces every prod device to do one
full re-pull (thundering-herd — acceptable, idempotent, but note it); existing prod posts already
have embeddings, so a server-side `updatedAt` touch (or the v3 client bump shipping via build/OTA)
backfills already-synced prod devices. Confirm whether issue #2 also affects prod before shipping.
