# Optimistic Background Ingestion for the Mobile Capture Tab

## 1. Problem statement

When a user taps **Process** on the mobile Capture tab (`apps/mobile/src/app/(tabs)/composer.tsx`, UI title "Capture"), the submit button spins and the UI **blocks** for the entire duration of the network transfer. `runSubmit()` (composer.tsx:642-658) wraps `await submitMaterials(...)` in a `try/finally` that only clears `busy` after every handler resolves, and a blocking pre-stage loop (composer.tsx:706-716) awaits `stageBinaryCopy` per asset first. For a large image, a video, or a big document, that means many seconds (or minutes) of a dead, spinning button before the user can do anything — and url/note duplicates additionally pop a synchronous `Alert.alert` (composer.tsx:740-758). This spec makes submit **non-blocking and optimistic for ALL material kinds**: tapping Process durably enqueues the capture and returns instantly, the user is navigated to the status board, and each item walks a live continuum — **Queued → Uploading NN% → Received → Drafting… → Done** (plus **Failed** / **Already saved** terminals) — with real screen-reader-grade progress semantics. Every material kind is routed through the existing durable SQLite outbox so the background flush/sync engine drives the actual uploads; submit never awaits the network.

## 2. Goals / Non-goals

### Goals
- Submit returns immediately after fast, durable local writes (SQLite outbox rows + optimistic post cards). **No awaited network upload on the submit path**, for every material kind (url, note, repo, image, video, audio, document).
- Every captured item appears **instantly** in the existing per-post status board (`apps/mobile/src/app/(tabs)/library.tsx`, the "In flight" section) and progresses through a single unified continuum.
- **Live upload percentage** for binaries via `expo-file-system` (legacy) `createUploadTask` `onUploadProgress`, plus a full label continuum for every kind.
- Dedup UX is fully optimistic and **in-board**: a server `deduped:true` response flips the row to an **"Already saved"** terminal with focusable **"Process again"** (force re-submit) and **"Dismiss"** controls — replacing the synchronous Alert.
- Close the handoff/flicker gap so an item never blinks out of the board between local send-success and the next server poll.
- **Accessibility is P0** (see §4.7 and §5): progressbar semantics, one meaningful label per row, non-color status conveyance, Dynamic Type, reduced-motion, WCAG-AA in both themes, sane VoiceOver focus movement.
- All status/label/throttle/dedup mapping factored into **pure, unit-tested modules** (the only viable mobile test path, `nav.test.ts` style).

### Non-goals
- **No server-side changes.** Recon confirmed the three intake endpoints (`/api/app/ingest`, `/api/app/ingest-images`, `/api/app/ingest-file`) already create `IngestSubmission` rows synchronously as `pending`, immediately visible to `GET /api/app/queue`, and return `{id, kind, status, deduped, retried, batchId?, imageIndex?, totalCount?}`. No new endpoint or DB column is required. A truly server-driven "Drafting" sub-state is explicitly out of scope.
- **The `😼ALOG` cat-pun catalog rename is a separate minor follow-up** (§7). It pulls in `react-native-svg` via `lucide-react-native` (a native module → requires `expo prebuild` + fresh EAS build + new fingerprint; NOT OTA-shippable) and is kept off the critical path.
- No new native module for the core work — the entire progress/outbox/board rework ships **OTA** (uses already-bundled `expo-file-system` legacy, `expo-sqlite`, drizzle).
- No true background-URLSession keep-alive (not offered by `expo-file-system`); backgrounded large uploads pause and resume on foreground (surfaced honestly, §4.6).

## 3. Current behavior (verified anchors)

**Blocking submit.** `submit()` composer.tsx:693-761 → `runSubmit()` composer.tsx:642-658 does `setBusy(true) … await submitMaterials(...)` in a `try/finally` that clears busy only after everything resolves. A blocking pre-stage loop composer.tsx:706-716 awaits `stageBinaryCopy` per asset. After send, `kickSync("submit")` (composer.tsx:724) and `finishSubmit()` (661-681) clear the tray, invalidate queries, and route to `/(tabs)/library`. url/note dedup pops a synchronous `Alert.alert` (composer.tsx:740-758); a "Saved on this device" Alert fires at 663-666.

**Materials core.** `apps/mobile/src/lib/materials.ts`: `submitMaterials(materials, ctx)` (:811-877) groups by kind and **awaits each handler sequentially**. HANDLERS (:782-792): url/note/repo → `apiPostJson('/api/app/ingest')`; image → `enqueueAndSendBinary('ingest-image')` (awaits the upload, per image, :561); video/audio/document → `enqueueAndSendBinary('ingest-file')`. Dedup: `submitUrl`/`submitNote` return `{deduped}` (ingest-submit.ts:15-23); handlers push to `deduped[]` and delete the optimistic local draft (materials.ts:376-386 url, 469-477 note, 421-423 repo). Images/video/audio/doc never dedup in practice (fresh batchId/byte identity, comment :295-298). `forceReprocess` (composer.tsx:684-691) → `runSubmit(dupes,true)` → `submitMaterials(..., {force:true})`. Binary enqueue-throw → `failed.push` (kept as a tray card).

**Durable outbox.** `apps/mobile/src/lib/outbox.ts`; SQLite `pending_submissions` table (`schema.ts:119-160`, `PendingRow` :162). `PendingStatus` (`schema.ts:38`) = `queued | in_flight | failed`. Staged bytes at `${documentDirectory}outbox/<id>/<file>`. `enqueueOutbox()` (:64-77) inserts JSON ingest rows; `enqueueBinary()` (:136-159); `enqueueAndSendBinary()` (:236-241) enqueues then sends now. `sendBinaryRow()` (:175-231) sets `in_flight` then `sent(delete)`/`failed(keep)`/`deferred(reset queued)`, `discardStagedCopy` on success (:205). `flushOutbox()` (:346-425) is single-flight, resets stray `in_flight → queued` (:353-356), FIFO-drains queued; JSON rows POST `/api/app/ingest` (:373); binary rows → `sendBinaryRow` (:413); a 4xx ingest row is currently **dropped** (:388-396). `nextAttemptAt` backoff column exists but is unused (:152). Triggers: `replayAndPull` in `sync/engine.ts:25` (cold-start :68, network :71-75, foreground :77-79, `kickSync` :100-103, background task :107-109 via `outbox-task.ts`).

**Upload (no progress today).** `apps/mobile/src/lib/api.ts`: `apiPostJson` → `authClient.$fetch` (:268-282). `uploadFile` (:344-366) uses `expo-file-system` (legacy) `uploadAsync` (MULTIPART) — **no `onUploadProgress`**; returns only on completion. `createUploadTask` (installed, `expo-file-system` 56.0.8, legacy submodule) supports progress but is unused. `endpointFor` (outbox.ts:41-43): images → `/api/app/ingest-images`, files → `/api/app/ingest-file`.

**Status board.** `apps/mobile/src/app/(tabs)/library.tsx` (route "library"; the retired Queue tab folded in, `queue.tsx` redirects here). Server submissions via `useQuery(['queue'])` `GET /api/app/queue?limit=50` polled every 5s (:116-120), filtered client-side to pending|processing|failed (:131-140); collapsed summary (:536-560); expanded rows (:561-615); failed rows show `errorMessage` + Discard `DELETE /api/app/queue/{id}` (:158-168). Local outbox via `useLiveQuery` over `pending_submissions` (status in queued|in_flight|failed, :187-206) rendered as a **single collapsed "N items uploading/waiting" banner** (:478-504); local failed rows show Requeue/Discard (:505-531). `StatusPip` (`sirius.tsx:166-174`); colors `submissionStatusPip()` (`theme.ts:329-337`) via `useStatusPip()` (`theme-context.tsx:66-69`).

**Server (no changes needed).** `GET /api/app/queue` → `listSubmissions` (`packages/db/src/ingest.ts:539-566`, scoped by `submittedById`, newest first; with no `?status` returns ALL of the caller's rows, `VALID_STATUSES` excludes only `flagged`). `IngestSubmission` status = `pending|processing|completed|failed|skipped|flagged`; state machine `pending→processing→completed|failed`. `createSubmission` inserts `pending` synchronously (:55); P2002 unique-violation → `findUnique` existing (:83); failed existing → requeued to `pending`, `status:'retried'` (:93); non-failed existing → `status:'deduped'`, no new row (:128). `markCompleted` sets `completed` + `resultPostSlug`/`resultPostId` + `completedAt` (:329); `startedAt` set on claim (:150-161). Intake is **session-only, no rate-limit/paywall** on all three POST routes; the weekly AI cap is enforced worker-side after enqueue and degrades to a DRAFT stub, never a failure.

## 4. Design

### 4.1 Non-blocking optimistic submit (outbox-first for ALL kinds)

Every handler in `submitMaterials` becomes **enqueue-and-return**:

- **url / repo / note** — instead of `apiPostJson('/api/app/ingest')`, build an `OutboxBody` (`urlIngestBody`/`noteIngestBody`) and call `enqueueOutbox(body, localId)`. Create the optimistic posts-mirror card for that `localId` so a queued url/note shows a card immediately (note already has this offline plumbing at materials.ts:487-499; url gets the same `localId` treatment).
- **image / video / audio / document** — replace `enqueueAndSendBinary` with **`enqueueBinary` only** (durable row, no await), and always create the optimistic posts card (today only created when a draft envelope exists, materials.ts:538-544).

`submitMaterials` (:811-877) then resolves after fast local writes; its returned `{submitted, queued, deduped, failed}` become **accepted/enqueued** counts. The synchronous `deduped[]` path shrinks to empty — dedup is now resolved later by the flush and surfaced in the board.

`runSubmit()` keeps `setBusy` only for the brief synchronous enqueue (tens of ms), then `finishSubmit()` navigates immediately (`pushOnce('/(tabs)/library')`, invalidate `['queue']` + `['posts']`, `kickSync('submit')`). The synchronous dedup Alert (composer.tsx:740-758) and the "Saved on this device" Alert (663-666) are **deleted** — instant navigation + the board (with a polite AT announcement + focus move, §4.7) is the confirmation. `forceReprocess` (684-691) becomes a thin wrapper that enqueues a `force:true` row; its board entry point is the "Process again" control (§4.4).

**Staging stays an awaited LOCAL copy (critical — data-loss fix).** Staging must NOT be taken off the durability path. `enqueueBinary` stores whatever `localFilePath` it is handed, and `sendBinaryRow` (outbox.ts:180-186) hard-fails a row to terminal `failed` "file missing" if that path no longer exists. Picker/camera URIs (`ph://`, cache-dir `file://`) are ephemeral and the OS evicts them (schema comment on `localFilePath` warns exactly this). The non-blocking goal is only about not awaiting **uploads**; a local byte copy is fast and does not conflict with it. Therefore:
- **Stage at PICK time**: when an asset is added to the tray, copy its bytes into `OUTBOX_DIR` (`outbox/<id>/<file>`) and mark the material non-submittable until its staged path resolves. Submit then still returns instantly but only ever enqueues rows backed by an on-disk app-private copy.
- **Never** enqueue a binary row whose `localFilePath` is an un-staged picker uri. Guard with an `isStagedPath()` check.
- If staging itself fails, keep the tray card (existing `failed.push` contract) and do not enqueue.

### 4.2 Unified status continuum (state → label table)

A pure module `ingest-status.ts` maps `(localRow?, serverRow?)` → a `UnifiedStatus` + display label + accessibilityLabel + progressbar `accessibilityValue`. The server has **no** `received` vs `drafting` distinction (both are `processing`; only `startedAt` signals a claim), so the continuum is composed from client upload phases + server row states:

| UnifiedStatus | Trigger (source of truth) | Display label | accessibilityValue | Example accessibilityLabel |
|---|---|---|---|---|
| `queued` | local row `queued`, not yet uploading | `Queued` | — | "my-article.com, queued" |
| `uploading` | local row `in_flight` + live pct | `Uploading NN%` | `{min:0,max:100,now:pct}` (`progressbar`) | "my-article.com, uploading 62 percent" |
| `received` | local `sent` **or** server `pending` | `Received` | — | "3 photos, received" |
| `drafting` | server `processing` | `Drafting…` | — | "recipe.com, drafting" |
| `done` | server `completed` + `resultPostSlug` | `Done` | — | "my-article.com, done" (deep-links to post) |
| `failed` | local `failed` **or** server `failed` | `Failed` | — | "video.mov, failed — <errorMessage>" |
| `already_saved` | local `deduped` | `Already saved` | — | "recipe.com, already saved" |

Boundary rules encoded and tested: `pct` guards `totalBytesExpectedToSend === 0` → 0 (no NaN); `pct` clamps 0–100; `retried:true` is **never** treated as dedup (it means work is re-queued → `received`); a partial image batch stays `received` until all slots complete (§4.5). `StatusPip` is extended so the dot's hue is never the sole state signal — always paired with the label text from `ingest-status` (WCAG 1.4.1).

### 4.3 Live-progress plumbing (throttled `createUploadTask`)

`uploadFile` (api.ts:344-366) is rewritten to keep `runWithAuthRetry` + `parseUploadResult` + the Cookie/`fieldName`/`mimeType`/`parameters` options unchanged, but swap `uploadAsync(...)` for:

```
const task = createUploadTask(url, fileUri, options, (d) =>
  onProgress?.({ pct: d.totalBytesExpectedToSend > 0
    ? Math.round(100 * d.totalBytesSent / d.totalBytesExpectedToSend) : 0,
    sent: d.totalBytesSent, total: d.totalBytesExpectedToSend }));
const result = await task.uploadAsync();
```

Import from **`expo-file-system/legacy`** (the modern API lacks `createUploadTask` — do not "upgrade" the path). `task.uploadAsync()` resolves to the same `FileSystemUploadResult` `parseUploadResult` already consumes; expose `task.cancelAsync()` up through `uploadFile` for future cancel. An `onProgress` param is threaded from `sendBinaryRow`.

Two new modules split fast animation from durable persistence (drizzle `useLiveQuery` is **table-level reactive** — any write to `pending_submissions` re-runs the board SELECT, so per-tick writes would thrash):
- **`upload-progress.ts`** — an in-memory event emitter/store keyed by pending row id (`subscribe`/`emit`/`get`). The board's progress bar reads fast per-tick pct from here for smooth animation, with **no** SQLite write.
- **`progress-throttle.ts`** — pure `shouldPersist(prevPct, nextPct, prevAtMs, nowMs) → boolean` (persist at ≥5–10% delta OR ≥500ms) and `coarseMilestone(pct) → 0|25|50|75|100` for polite AT announcements.

`sendBinaryRow` persists progress to SQLite only when `shouldPersist` returns true (durability + AT milestones); the emitter carries every tick.

### 4.4 In-board dedup row ("Already saved")

`flushOutbox`'s ingest branch reads `ok.deduped` / `ok.retried`:
- `deduped:true && !retried` → set the row to `deduped` and call `markPostDeduped(localId)`; render an **"Already saved"** terminal row. **Do NOT call `linkSubmission`** on a deduped row (critique fix): `ok.id` is the existing (often already-completed) submission, and binding the optimistic card to it lets the delta-pull reconcile absorb it into a normal synced catalog card, destroying the terminal + its controls. Keep the card purely local (no `submissionId` binding) so reconcile can't claim it.
- The row exposes two **real, individually focusable** controls (`Pressable`, `accessibilityRole="button"`, distinct label/hint):
  - **Process again** → enqueue a NEW outbox row with `force:true` (`OutboxBody.force` already exists; `force` is folded into the server `contentHashForUrls`, so a forced re-submit always creates a fresh row) under a fresh `localId` + fresh optimistic card, delete the deduped row, `kickSync`.
  - **Dismiss** → `markPostDeduped` cleanup + delete the row.
- Layout reuses the existing failed-row Requeue/Discard pattern (library.tsx:505-531) for parity.

Because images dedup on batch SLOT (fresh `batchId` per capture) and files on raw bytes (fresh staged bytes per capture), `already_saved` realistically fires **only** for url/note.

### 4.5 Handoff / no-flicker strategy

Today, on binary success `sendBinaryRow` deletes the local row instantly (outbox.ts:205-207) but the server `/api/app/queue` row only appears on the next 5s poll — for binaries with no draft card the item blinks out then back. Fix:

1. **New `sent` local state.** On a non-deduped 2xx, `sendBinaryRow` sets the row to **`sent`** (not delete) and keeps the staged bytes until reconcile. **This applies equally to the `flushOutbox` JSON/ingest branch** (critique fix) — url/note otherwise show the same blink.
2. **`reconcileSentRows(serverIds: Set<string>)`** deletes a `sent` row (and calls `discardStagedCopy`) as soon as ANY server queue row with that linked submission id is observed **in any state**.
3. **Drive reconcile off query DATA, not a removed callback (critique fix).** `@tanstack/react-query` v5 **removed** `onSuccess`/`onError`/`onSettled` from `useQuery`, so those callbacks silently never fire. Run `reconcileSentRows` in a `useEffect` keyed on `queueData` (or inside the `queryFn` right after the fetch resolves), and trigger the immediate post-send refetch with `queryClient.invalidateQueries({ queryKey: ['queue'] })` from `sendBinaryRow`'s success path (via a passed-in callback / event), never from `onSuccess`.
4. **Self-heal for stuck `sent` rows (critique fix).** The known "stale cookie → 401 on queue poll" failure would strand a `sent` row forever ("Received", never Done) and leak staged bytes. Add a fallback: delete a `sent` row + `discardStagedCopy` after a bounded number of unmatched polls / a short TTL even if unmatched (the bytes are already on the server, so dropping the local row can't lose data).

### 4.6 Background transfer honesty

`createUploadTask` uses a **foreground URLSession**; the progress callback does not fire while suspended, and `expo-background-task` only wakes the app (~15-min floor, ~30s iOS slice, none after force-quit) — it does not extend an in-flight transfer. A large video generally finishes only on next foreground (`AppState 'active'` → `replayAndPull` → `flushOutbox`). Kill-mid-upload recovery is already correct: the durable row + staged bytes exist before the send; `flushOutbox` resets stray `in_flight → queued` and re-sends idempotently (server `contentHash`). The board shows an honest **"Paused — resumes when you reopen"** presentation for an `in_flight`/queued binary while backgrounded, never a fake 100%.

### 4.7 Image-batch aggregation

Each image is its own outbox row (shared `localId`, distinct `row.id`, shared `batchId`) and the server creates one `IngestSubmission` per slot; the worker only claims the batch once ALL `totalCount` rows land (`claimReadyImageBatch`). Add an explicit **batch grouping layer keyed by `batchId`**:
- Aggregate the N per-slot local+server rows into **one** board item.
- Roll up progress across slots (mean, or min for a conservative bar).
- Derive batch status from the weakest slot: any uploading → `Uploading`; all `sent`/`pending` → `Received`; server `processing` → `Drafting`; all `completed` → `Done`; **any slot terminal-failed / assembly-timeout → `Failed` immediately** (don't wait for the server assembly timeout).
- On batch failure surface ONE row with a single **"Requeue batch"** control that re-enqueues ALL slots from their staged copies under a FRESH `batchId` (mirroring `discardSubmission`'s batch-sibling logic). This depends on §4.1 staging so the bytes exist to requeue.
- `ingest-status` accepts the aggregate and builds the `"<n> photos, <state>"` label from it (the a11y label "3 photos, drafting" is only producible via this layer).

### 4.8 Accessibility (P0, cross-cutting)

- **Progressbar semantics.** Every uploading row exposes `accessibilityRole="progressbar"` + `accessibilityValue={{min:0,max:100,now:pct}}` and a text fallback ("Uploading 62 percent") — never a bare visual bar.
- **Throttled polite announcements.** Progress is announced only at `coarseMilestone` boundaries (0/25/50/75/100) via a polite (non-assertive) live region / `AccessibilityInfo.announceForAccessibility`, never per-tick — VoiceOver/TalkBack must not be spammed.
- **One meaningful label per row.** Composed by `ingest-status` (item descriptor + state), e.g. "my-article.com, uploading 62 percent" / "3 photos, drafting" / "recipe.com, already saved". Status changes are conveyed to AT by text+icon, **not color alone** (WCAG 1.4.1).
- **Dedup controls** are real focusable `button`s with clear labels/hints, reachable by VoiceOver/switch/keyboard — not gesture-only.
- **Dynamic Type** — rows use `min-height` (not fixed/`max-height`), `allowFontScaling`, relaxed `numberOfLines`; no clipped labels.
- **Reduced motion** — honor `AccessibilityInfo.isReduceMotionEnabled()` (a `useReducedMotion` hook) to render a static progress fill instead of an animated bar.
- **Contrast** — every pip/label/progress color verified WCAG-AA in BOTH light (cream) and dark (midnight-navy) themes, centralized in `theme.ts` `submissionStatusPip()`.
- **Focus movement on navigation (critique fix).** After `finishSubmit` navigates, the target board/rows are not mounted synchronously, so `setAccessibilityFocus(boardRef)` fired immediately would no-op. Set focus from the board's own mount/`onLayout` (or `InteractionManager.runAfterInteractions` / a queued microtask keyed to the newest row ref), AND emit a polite `announceForAccessibility` fallback ("Capture queued, N items uploading") so a non-visual user always gets confirmation even if focus retargeting fails.

### 4.9 Data-model changes

`apps/mobile/src/lib/db/schema.ts` + drizzle migration `0006_optimistic_progress.sql` (+ `meta/_journal.json`, `migrations.js`):

- Widen the `PendingStatus` TS union (schema.ts:38) from `'queued' | 'in_flight' | 'failed'` to add `'sent'` (bytes accepted, awaiting the server handoff row) and `'deduped'` ("Already saved"). Because `status` is a plain SQLite text column, widening the union needs **no SQL**.
- Add columns to `pending_submissions` (schema.ts:119-160): `progress_pct` integer `DEFAULT 0`, `progress_bytes` integer (nullable), `progress_total` integer (nullable, for the AT byte fallback), `phase` text (nullable, coarse client-phase cache).
- Migration `0006` is hand-authored (Prisma-migrate-dev-style; the repo's other drizzle migrations were generated, but `migrate dev` is non-interactive in agent shells):
  ```sql
  ALTER TABLE pending_submissions ADD COLUMN progress_pct integer DEFAULT 0;
  ALTER TABLE pending_submissions ADD COLUMN progress_bytes integer;
  ALTER TABLE pending_submissions ADD COLUMN progress_total integer;
  ALTER TABLE pending_submissions ADD COLUMN phase text;
  ```
  Register it in `meta/_journal.json` + `migrations.js` so `runMigrations()` (client.ts, awaited in `<DbGate>` before first paint) applies it before any `useLiveQuery` reads the new columns.

Also thread `retried:boolean` onto the mobile `SubmitOk` type (ingest-submit.ts:15-23) to model the server field (submit.ts:114-146). `OutboxBody` already carries `force`, `localId`, and `requestJson`, so no storage change is needed for url/note routing or Process-again.

**Audience preservation (privacy — must verify, do not regress).** Today url/note post directly via `apiPostJson('/api/app/ingest')` with a body that includes the user-selected **`visibility`** (PRIVATE/FRIENDS/PUBLIC) and **`shareGroupIds`**. Routing these through `enqueueOutbox` → the `flushOutbox` JSON branch (POST `/api/app/ingest`) MUST send the identical body, or a queued url/note silently loses its audience and can leak more broadly than the user chose. Requirement: `OutboxBody`/`requestJson` (and the `urlIngestBody`/`noteIngestBody` builders) MUST serialize `visibility` + `shareGroupIds`; the plan's first step for the url/note slices is to confirm `requestJson` already round-trips these fields and, if not, add them. This is a P0 correctness/privacy invariant, tested by asserting the enqueued `requestJson` equals the pre-change direct-POST body for a FRIENDS/GROUP capture.

## 5. Edge cases & how they're handled

- **Data loss from un-staged picker URIs (HIGH).** Never enqueue a binary row pointing at an ephemeral picker/camera uri. Stage bytes into `OUTBOX_DIR` at **pick time** (awaited local copy), mark the material non-submittable until staged, guard with `isStagedPath()`. Submit still returns instantly; the durable row always points at an app-private copy. If staging fails, keep the tray card and don't enqueue. (§4.1)
- **Killed app mid-upload.** Durable row + staged bytes precede the send; on next foreground flush, stray `in_flight → queued`, re-send idempotently via server `contentHash`. (§4.6)
- **Backgrounded large video.** Foreground URLSession pauses when suspended; show "Paused — resumes when you reopen", not fake 100%. Completes on next foreground. (§4.6)
- **Offline.** Rows sit `queued`; `engine.ts` network/foreground/cold-start triggers replay when connectivity returns (unchanged). The optimistic card + board row persist across restarts.
- **Paywall / weekly AI cap.** No intake-time gate exists or is possible; the cap is worker-side and degrades to a completed DRAFT stub. `done` always deep-links to `resultPostSlug` regardless. No pre-check on submit.
- **Migration on existing installs.** `0006` must apply on BOTH fresh install (columns created) and upgrade-in-place (existing rows get `progress_pct` default 0). It is JS/SQL only → OTA-shippable, no fingerprint change. If it fails to register in `migrations.js`/`_journal.json`, `runMigrations` throws before first paint and bricks launch — verify both paths.
- **Duplicate local + server rows (blink / dead callback).** `sent` state + `reconcileSentRows` driven off query DATA (react-query v5 removed `onSuccess`) + immediate `invalidateQueries(['queue'])` on send-success + a poll-count/TTL self-heal for stuck `sent` rows (stale-cookie 401). Applies to both binary and JSON branches. (§4.5)
- **Dedup absorbed by reconcile.** On `deduped:true`, do NOT `linkSubmission`; keep the card purely local `already_saved` with no `submissionId`, cleared only by Dismiss/Process-again. (§4.4)
- **Image-batch partial failure.** Batch rollup marks the whole `batchId` failed on any terminal slot and offers one "Requeue batch" control re-enqueuing all slots under a fresh `batchId`. (§4.7)
- **`retried` vs dedup.** A re-submit of a previously-failed row returns `202 deduped:false retried:true` (row requeued) — treated as `received`/queued success, NOT `already_saved`. (§4.2)
- **Progress throttle / UI thrash.** Fast per-tick pct lives in the in-memory emitter (smooth bar); SQLite persists only at `shouldPersist` milestones; AT announces only at `coarseMilestone` boundaries. (§4.3, §4.8)
- **Divide-by-zero pct.** Guard `totalBytesExpectedToSend === 0 → 0` (uploads have no `-1` unknown sentinel). (§4.3)

## 6. Testing

No mobile test runner is wired beyond the pure-unit pattern in `apps/mobile/src/lib/nav.test.ts` (imported by `nav-dedupe.ts`). Keep all new pure logic free of React/SQLite/expo imports so it runs as plain TS. Do not claim automated tests pass beyond these pure suites.

1. **`ingest-status.test.ts`** — exhaustive matrix of `(local row status/progress × server row status/startedAt/resultPostSlug/errorMessage)` → `UnifiedStatus` + display label + accessibilityLabel + progressbar `accessibilityValue`. Boundaries: 0%, 100%, missing total (NaN guard), partial batch pending, `deduped`, `retried`-not-treated-as-dedup, batch aggregate (`"3 photos, drafting"`).
2. **`progress-throttle.test.ts`** — `shouldPersist` honors BOTH the ≥5–10% delta AND ≥500ms rules and never persists on tiny ticks; `coarseMilestone` buckets to 0/25/50/75/100.
3. **Dedup-state helper test** — mapping `SubmitOk {deduped, retried}` → next `PendingStatus` (`deduped` vs queued-success/`sent` vs `failed` on 4xx).
4. **Batch-rollup helper test** — per-slot statuses → aggregate batch status + rolled-up progress + `<n> photos` label.

Board/network/SQLite wiring that can't be unit-tested relies on the repo's agent-device runbook (`scripts/testing/MOBILE-E2E.md`): submit a URL, a note, a large image, and a video; watch the button return instantly and rows walk Queued → Uploading NN% → Received → Drafting → Done; force a dedup on a repeat URL to see "Already saved" + Process again; background mid-video-upload to confirm the "paused/resumes on reopen" state. Note the harness cannot reproduce sub-second timing.

## 7. Rollout & sequencing

**Tracer-bullet, one kind end-to-end before generalizing.**

- **Slice 1 (hard prerequisite): schema + migration 0006.** Land and run `runMigrations()` first; verify fresh install AND upgrade-in-place. JS/SQL only → OTA-safe.
- **Slice 2 (parallel): `api.ts` `createUploadTask` progress + `progress-throttle.ts` + `upload-progress.ts`** with their unit tests. Independent.
- **Slice 6 (parallel, land early): pure `ingest-status.ts` + tests.** Slices 4–8 render off it.
- **First vertical tracer: URL only** through the outbox (minimal slices 3+4 for url) + a minimal per-item board row (slice 7) so a single URL walks Queued → Received → Drafting → Done non-blocking.
- **Fan out:** note, then binaries (image/video/audio/doc) reusing `enqueueBinary` + progress + staging-at-pick-time.
- **Slice 5 (composer non-blocking + remove Alerts)** once slices 3–4 accept enqueue-only.
- **Slice 8 (in-board dedup row)** after 3+7 expose `deduped`.
- **Slice 9 (accessibility)** authored inline in each row/control as built — P0, not a trailing pass.
- **Slice 10 (secondary, isolated, last): `😼ALOG` cat-pun label.** Render the library eyebrow/title as CAT-emoji + "ALOG" with an inline `lucide-react-native <Cat/>` icon; keep the legible word "Catalog" and `accessibilityLabel` ALWAYS "Catalog" (emoji/icon decorative: `importantForAccessibility="no"`/`accessibilityElementsHidden`). This pulls in **`react-native-svg`** (native module) → requires `expo prebuild` + a fresh EAS build + a new native fingerprint; **NOT OTA-shippable**. Ship in a separate native release, keep `verify:native-ai` green, regenerate `ios/android` from `app.json`, never commit them.

**Migration ordering (rollout risk):** `0006` must be registered in both `meta/_journal.json` and `migrations.js` and ordered FIRST; a mis-registration throws in `<DbGate>` before first paint and bricks launch. No feature flag is proposed for the core change (it's a pure UX/reliability improvement of an existing path and degrades gracefully offline); a simple client constant could gate the board rework for a staged rollout if desired.

## 8. Open questions / risks

- **Backgrounded transfers do not complete while suspended** (foreground URLSession; `expo-background-task` only wakes, none after force-quit). A true keep-alive needs a native background URLSession — out of scope. Board must stay honest ("Paused — resumes when you reopen").
- **`useLiveQuery` is table-level reactive** — even throttled writes re-run the whole board SELECT. Per-tick pct MUST stay in the in-memory emitter; only milestones persist.
- **No server-driven "Drafting" sub-state** — both `received` and `drafting` are `processing` (only `startedAt` signals claim). The Drafting label is a client presentation; a real sub-state would need a new worker status field (out of scope).
- **Free users over the weekly AI cap** get a completed DRAFT stub, not a full post; `done` deep-links regardless.
- **Handoff reconcile correctness** depends on the `sent` self-heal (poll-count/TTL) surviving the known stale-cookie 401 poll failure, and on `linkSubmission(localId, ok.id)` id matching for every non-deduped kind; a mismatch would leave a duplicate or premature disappearance until the TTL fallback fires.
- **Removing the confirmation Alerts** shifts confirmation onto navigation + board; the VoiceOver focus move + polite announcement fallback must be reliable or a non-visual user loses the capture-in-flight signal.
- **Image-batch dead-letter timing** — even with immediate client-side rollup on a terminal slot, orphaned server `pending` rows for successfully-uploaded siblings persist until the server's `reclaimStaleImageBatches` timeout; "Requeue batch" mints a fresh `batchId` rather than reusing the orphaned one.
