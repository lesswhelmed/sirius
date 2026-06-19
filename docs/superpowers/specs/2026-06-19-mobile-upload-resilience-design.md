# Mobile Upload Resilience — Design

Date: 2026-06-19
Author: RubyFinch (agent session)
Scope: `apps/mobile` only
Status: approved design, pre-implementation

## Problem

When the app goes inactive/backgrounded (or is force-quit) mid-submission, in-progress
content can be lost and uploads fail. There is no way to requeue an upload that failed.

Today **notes and URLs are already resilient** — on a network failure they are persisted to
the `pendingSubmissions` outbox and replayed later. But **binary uploads (images, video,
audio, documents) are brittle**: they are never persisted to the outbox, they reference the
photo/document picker's ephemeral local URI, they upload immediately, and if the app is
backgrounded mid-upload or the submit errors, the content is gone. The outbox's `in_flight`
and `failed` states are *defined in the schema but never used*, and the Queue tab has no
"retry this failed upload" path for binaries.

## Goals

1. Mid-submission content survives backgrounding **and** force-quit by being copied to
   app-private disk storage the moment it is staged.
2. An upload **interrupted** by backgrounding/app-kill **auto-resumes** when the app reopens
   ("it shall complete") — it never becomes a user-visible failure.
3. An upload that **genuinely fails** (server 4xx, or a hard error) lands in a `failed`
   state with a manual **Requeue** button.
4. Disk holds **only** content not yet submitted; anything submitted/processed or removed
   from the tray is cleaned up promptly. In-memory tray state is temporary.
5. Keep it dumb and stupid — reuse the existing outbox machinery, no new subsystems.

## Non-goals

- True background uploading (continuing the HTTP upload while the app is backgrounded via a
  native module). The recovery model is "resume when reopened," not "upload while away."
- Persisting an **un-submitted** tray across app-kill (tray restore UX). The in-memory tray
  is intentionally ephemeral; only the on-disk byte copy survives staging. (Possible
  follow-up.)
- Web composer hardening (`apps/web`). Mobile only.

## Decisions (from brainstorming)

- **Durability:** copy picked bytes into app-private storage on staging; persist outbox rows
  on Submit. Survives force-quit.
- **Recovery model:** interrupted in-flight uploads auto-resume; genuinely failed ones need a
  manual Requeue tap. (Default trigger is manual — nothing auto-sends on a timer; the only
  automatic action is re-driving an interrupted in-flight row on app start/foreground.)
- **Batches:** each image is its own outbox row sharing a `batchId`/`totalCount`; requeue
  re-sends only the not-yet-succeeded indices. The server already waits for all `totalCount`
  rows before claiming the batch.
- **Copy timing:** on staging (when added to the tray), not on Submit.
- **Tray durability:** not persisted across kill; only the on-disk byte copy survives.

## Approach (chosen)

**Extend the existing `pendingSubmissions` outbox to cover binaries.** Route
images/video/audio/documents through the same table that already carries notes/URLs, so the
existing replay loop (cold-start, network-reconnect, app-foreground, ~15-min background task)
becomes the auto-resume engine for free.

Rejected alternatives:
- A separate upload-manager subsystem — duplicates the replay/trigger machinery.
- A native background-upload module — heavy native dependency on an already-delicate
  EAS/llama.rn native setup; more than the stated goal.

## Architecture

### 1. Data model — `apps/mobile/src/lib/db/schema.ts` (additive only)

`pendingSubmissions` already has: `status: queued | in_flight | failed`, `attempts`,
`lastError`, `nextAttemptAt`, `batchId`, `imageIndex`, `totalCount`, `transport`,
`requestJson`, `localId`. Add two columns:

- `localFilePath: text` — absolute path to the app-private copy of the binary (null for
  note/url rows).
- `inFlightStartedAt: integer` (epoch ms, nullable) — set when a row flips to `in_flight`;
  used to detect interrupted uploads.

No new tables. No changes to any other table. Drizzle migration is append-only to one table.

### 2. Staging → durable copy — `composer.tsx` + `ingest-submit.ts`

When the user adds a binary to the tray, copy its bytes from the picker URI into
`<documentDirectory>/outbox/<submissionId>/<filename>` via `expo-file-system`. The tray
references the durable copy, not the ephemeral picker cache. Removing the item from the tray
deletes its on-disk copy immediately.

On **Submit**, every material — notes, URLs, and binaries — gets a `pendingSubmissions` row
written **before** any network call. Binary rows carry `localFilePath`.

### 3. The send loop — `apps/mobile/src/lib/outbox.ts`

One unified replay path. For each `queued` row:
1. Flip to `in_flight`, stamp `inFlightStartedAt`.
2. Upload (notes/URLs via JSON `requestJson`; binaries from `localFilePath` via the existing
   `uploadAsync` multipart path).
3. On success: delete the row **and** its on-disk file.
4. On a real error: increment `attempts`, set `lastError`, set `status = failed`.

A single bad row must not abort the whole loop (per-row try/catch).

### 4. Interrupted-vs-failed detection — `apps/mobile/src/lib/sync/engine.ts`

On cold-start and on AppState → `active`, scan for rows still at `in_flight`. Because the JS
runtime cannot survive backgrounding mid-`await`, any row still `in_flight` at startup was
**cut off** → reset it to `queued` and run the send loop. This is the auto-resume that makes
an interrupted upload "complete." (Additive hook; coordinated with LavenderKite who owns the
pull side of this file.)

### 5. Batch requeue — `materials.ts` + `outbox.ts`

Each image = its own row sharing `batchId`/`totalCount`. Requeue re-sends only rows not yet
succeeded. No duplicate images server-side; the same post completes once all `totalCount`
rows land.

### 6. Queue UI — `apps/mobile/src/app/(tabs)/queue.tsx`

Device-side section gains:
- `in_flight` rows shown as "Uploading…".
- `failed` rows shown with a **Requeue** button (resets `attempts`, clears `lastError`, sets
  `status = queued`, kicks the send loop) and a **Discard** action (deletes the row + its
  on-disk file).

### 7. Cleanup contract

On-disk copy is deleted when:
- The user removes the item from the tray before Submit.
- Its outbox row succeeds (submitted/processed).
- The user discards a `failed` row.
- Startup sweep: remove orphaned `outbox/<submissionId>/` dirs with no matching outbox row
  (covers a kill-before-Submit, since the tray itself is not persisted).

## Data flow (binary, happy + interrupted paths)

```
stage file → copy bytes to outbox/<sid>/<file> (disk)         [tray references disk copy]
Submit     → write pendingSubmissions row (queued, localFilePath)
send loop  → in_flight (+inFlightStartedAt) → uploadAsync → success → delete row + file
                                            ↘ error → failed (attempts++, lastError)

backgrounded mid-upload: row left at in_flight (await never returned)
app reopens: engine scan → in_flight found → reset queued → send loop → completes

genuine failure: row at failed → Queue shows Requeue → reset queued → send loop
```

## Error handling

- Per-row try/catch in the send loop; one failure never aborts the batch or the loop.
- Transient (network/5xx) vs permanent (4xx): both currently land in `failed` after the
  attempt; auto-resume only re-drives `in_flight` (interrupted), not `failed`. The user
  decides via Requeue. (Manual recovery model.)
- `localFilePath` missing on disk at send time (e.g. user cleared app data) → mark the row
  `failed` with a clear `lastError`; Discard removes it.

## Files to modify

| File | Change | Owner / coordination |
|------|--------|----------------------|
| `apps/mobile/src/lib/db/schema.ts` | +`localFilePath`, +`inFlightStartedAt` on `pendingSubmissions`; drizzle migration | SHARED — coordinate with LavenderKite |
| `apps/mobile/src/lib/sync/engine.ts` | additive cold-start/foreground hook to re-drive `in_flight` | SHARED — coordinate with LavenderKite |
| `apps/mobile/src/lib/outbox.ts` | unified send loop incl. binaries; in_flight/failed states | RubyFinch |
| `apps/mobile/src/lib/materials.ts` | route binaries through outbox; batch requeue | RubyFinch |
| `apps/mobile/src/lib/ingest-submit.ts` | write outbox rows pre-upload; carry localFilePath | RubyFinch |
| `apps/mobile/src/lib/api.ts` | upload from localFilePath; surface failure cleanly | RubyFinch |
| `apps/mobile/src/app/(tabs)/composer.tsx` | copy-on-stage; tray cleanup on remove | RubyFinch |
| `apps/mobile/src/app/(tabs)/queue.tsx` | in_flight/failed rows + Requeue + Discard | RubyFinch |

## Testing / verification

No automated test runner in this repo. Verification is manual on the iOS simulator
(see `scripts/testing/MOBILE-E2E.md`), exercising:
1. Stage images → background mid-upload → reopen → upload auto-resumes and completes.
2. Force a server failure → row goes `failed` → Requeue → completes.
3. Multi-image batch with one image failing → Requeue re-sends only the missing image.
4. Stage then remove from tray → on-disk copy is gone.
5. Stage → force-quit before Submit → startup sweep removes the orphaned dir.
6. `bunx tsc --noEmit` and `bunx eslint <files> --max-warnings 0` in `apps/mobile`.

## Coordination notes

- Concurrent agent **LavenderKite** owns the PULL/reconcile side
  (`sync/reconcile.ts`, `sync/comment-reconcile.ts`, `sync/changes-pull.ts`) — RubyFinch
  stays out of those.
- Shared files `db/schema.ts` and `sync/engine.ts`: edits kept additive; file reservations
  taken via agent-mail at edit time; commits stage only RubyFinch-owned paths explicitly
  (never `git add -A`).
