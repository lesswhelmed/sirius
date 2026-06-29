# Video-capture loss — durability

## Problem

A video recorded with the built-in camera can fail to reach the server with **no feedback to the user**. In the worst case (GAP 1) it never enters the tray and is dropped permanently; in another (GAP 2) it fails silently at submit with no durable record. The dangerous moment is **before a durable outbox row exists**, which is the only thing that makes a capture reliably visible and retryable.

What works today (verified):
- `enqueueAndSendBinary` persists a durable `pending_submissions` row via `enqueueBinary` **before** the network upload — `apps/mobile/src/lib/outbox.ts:229-234` (`enqueueAndSendBinary`) calling `enqueueBinary`, which inserts at `outbox.ts:150` (`await db.insert(pendingSubmissions).values(row)`), so a kill mid-upload is recoverable.
- The Catalog tab (route `library`) renders any `queued` / `in_flight` / `failed` outbox row in its **"In flight"** section — `apps/mobile/src/app/(tabs)/library.tsx:187-206` (`useLiveQuery` over `pendingSubmissions` filtered to those three statuses, split into `outboxWaiting` / `outboxFailed`; rendered at `library.tsx:470-565`). Note: there is **no separate "Queue" tab** — the Queue screen was retired and folded into Catalog (`library.tsx:48-49`, `:110`). When this doc says "the Queue," it means this In-flight section.

So a video that **enqueues** is durable and retryable. The risk is on the paths that throw **before** that row exists. Two such gaps:

**GAP 1 (prime suspect — a true loss).** `stageAndAddAssets` copies each captured asset into the durable outbox at `composer.tsx:289` — `const uri = await stageBinaryCopy(asset.uri, asset.name);` — with **no try-catch** (`apps/mobile/src/app/(tabs)/composer.tsx:282-307`). `stageBinaryCopy` does `makeDirectoryAsync` + `copyAsync` (`outbox.ts:90-100`). A large video copy is the most likely thing to throw (low disk space, an evicted/expired picker temp URI, an aborted copy). On throw the whole `for` loop rejects: the asset is never classified, never registered, never appended to the tray (`setRegistry`/`appendItems` at `composer.tsx:295-306` never run), no error is shown, and the original capture is orphaned. Reached from both `captureVideo` (`composer.tsx:464-490`, stages at 487) and `pickVideo` (`composer.tsx:418-434`, stages at 433). Note the camera-open call itself is already guarded (`composer.tsx:474-485`); the unguarded copy at 289 is the hole.

**GAP 2 (silent failure, no surface).** The video handler calls `enqueueAndSendBinary` with **no try-catch** — `apps/mobile/src/lib/materials.ts:582-609` (the `await enqueueAndSendBinary(...)` at `materials.ts:589`). `sendBinaryRow` swallows the **network** error around its `uploadFile` call (returns `"deferred"`/`"failed"`), so under normal conditions the throw source is `enqueueBinary`'s `db.insert` at `outbox.ts:150` — though `sendBinaryRow`'s pre-upload `getInfoAsync` (`outbox.ts:175`) and in-flight `db.update` (`outbox.ts:183-186`) also run outside its try/catch and could throw. If any of these throws, no durable row exists, and the throw propagates up through `submitMaterials` (`materials.ts:798-803`) → `runSubmit` → `submit()`, where it short-circuits at the `await runSubmit(...)` (`composer.tsx:671`) **before** the alert or any tray-clear. The result is a **silent failure**: no error is shown and no `pending_submissions` row is recorded. (The tray card actually *remains* — the throw bypasses `setItems`/`finishSubmit` — so the capture is not permanently lost in this path, but the user gets zero feedback and no durable record, and a later `sweepOrphanUploadsOnce` could delete any staged bytes.) The handler also unconditionally returns `failed: []` (`materials.ts:607`), so even if the throw were caught and converted to a return, the composer's keep-failed-staged logic could not single out and retain that card.

**Correction (do not chase this).** Videos not creating an optimistic local post is **not** the issue. Images create an optimistic post only when on-device AI curation is on — `materials.ts:531-537` (`createLocalDraft` only when `sightDraft` is truthy); the video handler intentionally has no local post (`localId: Crypto.randomUUID()` at `materials.ts:591`). The In-flight view shows the **outbox row**, not the optimistic post, so optimistic-post parity is a Catalog-visibility nicety, deferred (see Out of scope).

## Root cause

Both capture paths replace a durable persist step with a bare `await` that can throw, and on throw the capture is dropped (GAP 1) or fails silently with no record (GAP 2):
1. `stageAndAddAssets` (`composer.tsx:289`) lets a `stageBinaryCopy` rejection abort the add before the item enters the tray.
2. `videoHandler` (`materials.ts:589`) lets an `enqueueBinary` insert rejection propagate before a durable row exists, with no error surfaced, and never returns the material as `failed`, so the composer's keep-failed-staged logic (`composer.tsx:679-683`) cannot deliberately retain it with feedback.

## Design

Chosen approach: **Guard + surface + keep file**. Three bounded units. The invariant: a capture must always end up either (a) in the tray as a retained card, or (b) as a durable `pending_submissions` row visible in the In-flight section — and the user must always get feedback, never a silent no-op.

### Unit A — Guard staging, keep the capture (GAP 1)

In `stageAndAddAssets` (`composer.tsx:282-307`), wrap the per-asset stage in try-catch:
- On `stageBinaryCopy` success: behave exactly as today (register the durable uri, classify, append).
- On `stageBinaryCopy` failure: **keep the item** — register it with the **original un-staged `asset.uri`** (`durable = asset` instead of `{ ...asset, uri }`), still `classifyFile(descriptorFromAsset(...))`, still push to `staged`/`classified` so it lands in the tray and `registry`. Collect the failure for surfacing.
- After the loop, if any asset failed to stage, surface one `Alert` (see Data flow / surface). The submit-time re-stage (Unit C) gives the durable copy a second chance while the picker uri is still alive.

This keeps the existing single-utterance `appendItems(...)` announce for the successfully-added items and never drops a capture on a copy error.

### Unit B — Guard the enqueue, return the capture as `failed` (GAP 2)

In `videoHandler.submit` (`materials.ts:582-609`), wrap the `enqueueAndSendBinary` call in try-catch:
- Success path unchanged (`"sent"` → `submitted++`; `"deferred"` → `queued++`; `"failed"` → error string "Video N failed — retry from the In-flight section.").
- On **throw** (no durable row exists — insert or a pre-upload step in `sendBinaryRow` failed): push `m` into a `failed: VideoMaterial[]` array and push an error string ("Video N couldn't be saved — kept so you can try again."). Return `failed` populated instead of `failed: []`.

The composer's `submit()` already keeps exactly the cards whose mapped `Material` is in `result.failed` (`composer.tsx:679-683`) and shows an Alert — so a failed enqueue now retains the tray card *with feedback* and a clear retry path, instead of the current silent short-circuit. Apply the same guard to the other binary handlers that share this hazard (`audioHandler` `materials.ts:681-694`, `documentHandler` `materials.ts:703-728`, and the `imageHandler` loop `materials.ts:547-572`) so no binary kind can throw past the durable-row boundary; image failures already route to `failed:[]` by design (binary failures live as `failed` outbox rows), so for the image handler the guard only needs to convert an **enqueue throw** (no row) into an error string + keep, matching its existing comment at `materials.ts:573-574`.

### Unit C — Re-attempt the durable copy at submit time

Items kept via Unit A carry the original picker uri, which may be evicted later. At submit, before building material pairs, re-stage any registered asset whose uri is **not already** an outbox-staged path, so the bytes are copied into durable storage while the picker uri is still valid:
- Add an exported `isStagedPath(path: string): boolean` to `outbox.ts` (returns `path.startsWith(`${OUTBOX_DIR}/`)`), since `OUTBOX_DIR` is module-private.
- In `composer.tsx:submit()` (`composer.tsx:659`), before `toMaterialPairs` (`composer.tsx:670`), run a best-effort pass over `registry`: for each asset whose `uri` is not `isStagedPath`, call `stageBinaryCopy(asset.uri, asset.name)`; on success, update that registry entry's uri to the durable copy; on failure, leave the original uri in place (Unit B still makes the submission recoverable as a durable row).

This makes "kept with original uri" self-healing: the common case (staging failed transiently at capture, e.g. a momentary disk pressure) recovers a durable copy at submit, and the worst case still produces a recoverable In-flight row.

## Data flow

Capture → stage → tray → submit → enqueue → upload:

1. **Capture** (`captureVideo` / `pickVideo`) → `stageAndAddAssets([asset])`.
2. **Stage (Unit A):** try `stageBinaryCopy(asset.uri, asset.name)`.
   - success → registry uri = durable outbox path.
   - failure → registry uri = original `asset.uri`; failure recorded → **Alert** surfaced after the loop.
   - Either way the card appears in the tray (`appendItems`).
3. **Submit (Unit C):** for each registry asset, if `!isStagedPath(uri)` re-`stageBinaryCopy`; on success swap to the durable path. Then `toMaterialPairs` builds `Material.uri` from the (now best-effort durable) registry uri.
4. **Enqueue (Unit B):** `videoHandler` → `enqueueAndSendBinary({ localFilePath: m.uri, ... })`.
   - `enqueueBinary` inserts the durable `pending_submissions` row (`outbox.ts:129-152`) **before** upload, then `sendBinaryRow` uploads.
   - If the insert (or a pre-upload step) throws → handler catches → material returned in `failed` → composer keeps the tray card (`composer.tsx:679-683`) and Alerts.
5. **Visible/retryable:** any row in `queued`/`in_flight`/`failed` shows in the Catalog tab's In-flight section (`library.tsx:187-206`); `failed` rows offer Requeue/Discard.

**Precedence rules:**
- A successfully-staged uri (outbox path) is authoritative; Unit C never re-stages it (`isStagedPath` guard) — no double copy.
- The durable `pending_submissions` row is the source of truth for "queued/recoverable", not the optimistic post. The tray card is the fallback artifact when no row could be created.
- Surface choice: stage failures (Unit A) → one `Alert` (non-blocking, does not set a critical tray error, so submit stays enabled). Enqueue failures (Unit B) → flow through the existing `result.errors` Alert in `submit()` (`composer.tsx:684`) and keep-staged path.

## Files & changes

| File | Lines | Change |
| --- | --- | --- |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 282-307 | Unit A: wrap the per-asset body of `stageAndAddAssets` in try-catch; on `stageBinaryCopy` failure register the item with the original `asset.uri` and still classify/append; collect failures and surface one `Alert` after the loop. |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 659-670 | Unit C: before `toMaterialPairs`, best-effort re-stage registry assets where `!isStagedPath(uri)` via `stageBinaryCopy`, swapping the registry uri to the durable copy on success. |
| `apps/mobile/src/lib/outbox.ts` | 37, after 100 | Export `isStagedPath(path: string): boolean` = `path.startsWith(`${OUTBOX_DIR}/`)` (OUTBOX_DIR defined at `outbox.ts:37`). |
| `apps/mobile/src/lib/materials.ts` | 582-609 | Unit B: wrap `enqueueAndSendBinary` (call at 589) in try-catch; on throw push `m` to a `failed: VideoMaterial[]` and an error string; return `failed` populated instead of `failed: []`. |
| `apps/mobile/src/lib/materials.ts` | 547-572, 681-694, 703-728 | Apply the same enqueue-throw guard to `imageHandler`, `audioHandler`, `documentHandler` so no binary kind throws past the durable-row boundary; convert an enqueue throw into an error string (+ keep, for the single-file kinds). |
| `apps/mobile/src/lib/outbox.ts` | 229-234 | (No change needed.) The sequential `const row = await enqueueBinary(input); return sendBinaryRow(row);` already short-circuits before upload if the insert throws — the throw propagates to the Unit B handler guard. Listed only to document that no "don't-proceed-to-upload" hardening is required here. |

## Edge cases & error handling

- **Multi-asset stage (`pickImages`, 8 images):** Unit A's try-catch is per-asset, so one failed copy keeps that one with its original uri while the others stage normally; one summary Alert lists the count that couldn't be saved.
- **Re-stage at submit also fails:** Unit C leaves the original uri; Unit B still creates a durable `pending_submissions` row from that uri, so the capture is recoverable from the In-flight section. If the original uri is already evicted, `sendBinaryRow`'s missing-file check (`outbox.ts:174-181`) marks the row `failed` (`lastError: "file missing"`) — visible in Catalog's In-flight section, not silently lost.
- **Insert genuinely fails (SQLite unwritable):** no row can exist; Unit B keeps the tray card so the user can retry; the Alert tells them it wasn't queued. This is the only path where the artifact lives solely in the tray (acceptable per the durability invariant; SQLite-loss is out of scope below).
- **`isStagedPath` on a non-outbox uri:** returns false → re-stage attempted; on a path already under `OUTBOX_DIR` returns true → skipped, no double copy. Mirrors `discardStagedCopy`'s existing prefix guard (`outbox.ts:107`).
- **Removal cleanup:** `removeItem` already discards the staged copy (`composer.tsx:231-238`); an item kept with an original (un-staged) uri passes a non-outbox path to `discardStagedCopy`, which no-ops safely (`outbox.ts:104-110`).
- **Submit blocking:** stage-failure surfacing must use `Alert`, not a `critical` `InlineError`, so `trayErrors.hasCritical` (`composer.tsx:207`, gate at `composer.tsx:660`) stays false and the user can still submit the retained capture.

## Out of scope / deferred

- **Optimistic local post for video (Catalog parity):** intentionally not added; the In-flight section surfaces the durable outbox row, which is what matters for durability. (`materials.ts:591` keeps a synthetic `localId` with no `createLocalDraft`.)
- **Persisting the tray to SQLite (crash-window protection):** if the app is killed after a capture is in the tray but before submit, an un-staged (Unit A fallback) item is lost. Persisting the in-memory tray to SQLite would close this window but is a larger change and not chosen for this pass. Note the existing `sweepOrphanUploadsOnce` (`outbox.ts:273-297`) only covers staged-but-no-row bytes, not tray state.
- **A dedicated non-blocking `warn` tray-error code for stage failures** (vs. the chosen `Alert`): would require extending the shared `InlineError.code` union (`packages/ingest-classify/src/types.ts:47-53`) plus the consolidate/validate logic; deferred in favor of the simpler `Alert`.

## Open questions

None.
