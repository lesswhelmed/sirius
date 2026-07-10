# Plan 007: Comment outbox must keep a comment queued on a 401 (not drop it)

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- apps/mobile/src/lib/comment-outbox.ts apps/mobile/src/lib/outbox.ts`
> If either changed, compare the excerpts below to the live files first.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

The mobile comment outbox permanently **drops a queued comment on a transient 401**.
Its replay `catch` treats any `4xx` (including 401) as terminal: it marks the local
comment failed and deletes the queued row. But `apiPostJson` → `runWithAuthRetry`
can surface a `401` when a cookie is valid locally yet rejected server-side (a common
cold-start/foreground case) — after which the app signs out and the post-re-login
replay should resend. The **post** outbox already handles this correctly (keeps the
row `queued` on 401). This bug silently loses a user's typed comment — the worst UX
outcome, and invisible server-side. The fix mirrors the proven post-outbox branch.

## Current state

- `apps/mobile/src/lib/comment-outbox.ts` — the buggy replay catch (lines 88–119):

```ts
      try {
        const ok = await apiPostJson<CreateOk>(
          `/api/app/posts/${row.postSlug}/comments`,
          row.requestJson as Parameters<typeof apiPostJson>[1],
        );
        await linkCommentSubmission(row.localId, ok.comment.id);
        sent++;
        await db.delete(pendingComments).where(eq(pendingComments.id, row.id));
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          console.warn(
            `[comment-outbox] dropping rejected item (${err.status}): ${err.message}`,
          );
          await markLocalCommentFailed(row.localId);       // <-- 401 lands here
          await db
            .delete(pendingComments)
            .where(eq(pendingComments.id, row.id));         // <-- comment deleted
          continue;
        }
        await db
          .update(pendingComments)
          .set({
            attempts: row.attempts + 1,
            lastError:
              err instanceof ApiError
                ? `server error (${err.status})`
                : "no connection",
          })
          .where(eq(pendingComments.id, row.id));
        break;
      }
```

- **Exemplar — `apps/mobile/src/lib/outbox.ts`** handles 401 FIRST, before the
  generic 4xx branch. Its documented policy (lines ~209–213) and the 401 branch
  (~288–301): a 401 means the session is dead (stale cookie / signed out), NOT a bad
  payload, so it keeps the row `queued` with `lastError: "needs sign-in"` and
  `break`s, so the post-re-login replay (SyncRunner) resends it. The comment outbox
  is missing exactly this branch.

- Confirm the helpers available in `comment-outbox.ts`: it already imports
  `ApiError` and uses `db.update(pendingComments).set({...})`. The `pendingComments`
  row has `attempts` and `lastError` columns (used in the generic branch below).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `bun run check-types` | exit 0 |
| Lint | `bun --cwd apps/mobile run lint` | exit 0 |
| Mobile tests | `bun --cwd apps/mobile test` | pass (incl. any new test) |

## Scope

**In scope**:
- `apps/mobile/src/lib/comment-outbox.ts`
- `apps/mobile/src/lib/comment-outbox.test.ts` (create — see Test plan; only if the
  replay logic can be unit-tested without the native DB, or by extracting the
  status-classification into a pure helper)

**Out of scope**:
- `apps/mobile/src/lib/outbox.ts` — the reference implementation; do not change it.
- The auth-retry logic in `api.ts` / `runWithAuthRetry` — the 401 escaping is the
  documented, correct behavior; this plan handles it at the outbox, matching the
  post outbox.
- Any change to how comments are created online (the happy path).

## Git workflow

- Branch: `advisor/007-comment-outbox-401`
- Commit explicit paths only (`git commit -- apps/mobile/src/lib/comment-outbox.ts [apps/mobile/src/lib/comment-outbox.test.ts]`).
  **Never `git add -A`.**
- Message: `fix(mobile): keep queued comment on transient 401 (match post outbox)`.

## Steps

### Step 1: Add a 401 branch BEFORE the generic 4xx branch

In the `catch (err)` block, add a first branch: if
`err instanceof ApiError && err.status === 401`, do NOT delete the row and do NOT
`markLocalCommentFailed`. Instead update the row to stay effectively queued —
increment `attempts`, set `lastError: "needs sign-in"` — and `break` the loop so the
post-re-login replay resends it (mirror `outbox.ts`'s 401 handling: the row must
survive to be retried after sign-in). The existing generic `4xx` branch then handles
only **non-401** 4xx (genuine client rejections: 400/403/404/409 → drop, which is
correct for a truly rejected payload).

Target shape:

```ts
      } catch (err) {
        // 401 = session dead (stale cookie / signed out), not a bad payload. Keep
        // the row so the post-re-login replay resends it — mirrors outbox.ts.
        if (err instanceof ApiError && err.status === 401) {
          await db
            .update(pendingComments)
            .set({ attempts: row.attempts + 1, lastError: "needs sign-in" })
            .where(eq(pendingComments.id, row.id));
          break;
        }
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          // ...existing terminal-drop branch, now 401-free...
        }
        // ...existing 5xx / no-connection branch...
      }
```

**Verify**: `bun run check-types` → exit 0; `bun --cwd apps/mobile run lint` → exit 0.

### Step 2: Confirm the queued row survives and doesn't busy-loop

The 401 branch `break`s (does not `continue`), so one 401 stops this flush pass — the
row remains in `pendingComments` for the next lifecycle-triggered replay. Confirm the
row is NOT deleted and NOT marked failed on 401.

**Verify**: read the diff — on the 401 path there is no `db.delete(pendingComments)`
and no `markLocalCommentFailed`.

## Test plan

- Preferred: extract the error→disposition decision into a pure helper (e.g.
  `classifyCommentReplayError(err): "drop" | "requeue" | "retry"`) and unit-test it,
  following an existing pure-logic mobile test such as
  `apps/mobile/src/lib/submit-result.test.ts` or `apps/mobile/src/lib/nav.test.ts`.
  Cases: `ApiError(401)` → `requeue`; `ApiError(403)`/`ApiError(404)` → `drop`;
  `ApiError(500)` → `retry`; non-ApiError (no connection) → `retry`.
- If extraction is impractical without a broader refactor, at minimum add a test
  that constructs the catch logic's classification inline and asserts a 401 is not
  in the terminal-drop set. Do not build a full native-DB harness for this.
- Verification: `bun --cwd apps/mobile test` → all pass, including the new case
  proving 401 is not dropped.

## Done criteria

- [ ] `comment-outbox.ts` has a 401 branch that keeps the row queued and does not delete it or mark it failed
- [ ] The generic 4xx terminal-drop branch no longer catches 401
- [ ] `bun run check-types` exits 0
- [ ] `bun --cwd apps/mobile run lint` exits 0
- [ ] `bun --cwd apps/mobile test` passes, with a new test proving 401 is requeued not dropped
- [ ] `git status` shows only the in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- `pendingComments` has no `attempts`/`lastError` columns (schema differs from the
  generic branch's usage) — report the actual columns.
- The post outbox's 401 policy has changed in `outbox.ts` since planning (it no
  longer keeps rows queued on 401) — the reference behavior is the source of truth;
  report the discrepancy before matching it.
- Unit-testing requires standing up the native expo-sqlite DB — report that and fall
  back to the pure-helper extraction (do not build a native DB test harness here).

## Maintenance notes

- The comment outbox and post outbox now share a 401 policy; if that policy changes
  (e.g. a max-attempts cap on "needs sign-in" rows), update BOTH to stay consistent.
- A reviewer should confirm the 401 branch is ordered BEFORE the generic 4xx branch —
  ordering is the whole bug.
- Follow-up worth noting: a genuinely repeated 401 with no re-login will keep the row
  forever (same as the post outbox). That's acceptable parity; a future attempts-cap
  could tombstone abandoned rows in both outboxes together.
