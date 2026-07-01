# Optimistic Background Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile Capture "Process" button non-blocking and optimistic for every material kind, driving uploads through the durable outbox in the background while the Catalog "In flight" board shows a live upload/preprocessing continuum.

**Architecture:** Split *enqueue* from *send*. Submit stages bytes at pick time (awaited local copy), then only enqueues durable `pending_submissions` rows and returns; the existing `flushOutbox`/sync engine performs uploads with live progress. The In-flight board renders those local rows merged with the server `/api/app/queue` rows through one pure status mapper. All decision logic (status continuum, progress throttle, dedup mapping, batch rollup) lives in pure, unit-tested modules with zero React/SQLite/expo imports.

**Tech Stack:** Expo SDK ~56, React Native 0.85, expo-router ~56, `expo-file-system/legacy` (`createUploadTask`), `expo-sqlite` + drizzle (`useLiveQuery`), `@tanstack/react-query` v5, `bun:test` for pure units.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec.

- **No server-side changes.** The three intake endpoints already create `IngestSubmission` rows synchronously as `pending`, visible to `GET /api/app/queue`, returning `{id, kind, status, deduped, retried, batchId?, imageIndex?, totalCount?}`.
- **Core work ships OTA** — no new native module. The only native-rebuild item is the secondary `😼ALOG` rename (Task 15), which pulls in `react-native-svg` via `lucide-react-native` and is done LAST in a separate native release.
- **`createUploadTask` is imported from `expo-file-system/legacy`** — the modern API lacks it. Do NOT "upgrade" the import path.
- **`@tanstack/react-query` v5 removed `useQuery` `onSuccess`/`onError`/`onSettled`.** Never wire logic to them (they silently never fire). Drive reconciliation off query *data* (`useEffect` on `queueData` or inside `queryFn`) + `queryClient.invalidateQueries`.
- **`useLiveQuery` is table-level reactive** — any write to `pending_submissions` re-runs the board SELECT. Per-tick upload pct MUST live in an in-memory emitter; only `shouldPersist` milestones write to SQLite.
- **Staging is an awaited LOCAL copy at PICK time.** Never enqueue a binary row whose `localFilePath` is an ephemeral picker/camera uri (`ph://`, cache-dir `file://`) — the OS evicts them → permanent capture loss. Guard with `isStagedPath()`. If staging fails, keep the tray card and do not enqueue.
- **Privacy invariant:** `OutboxBody`/`requestJson` MUST serialize the user-selected `visibility` (PRIVATE/FRIENDS/PUBLIC) and `shareGroupIds`, or a queued url/note loses its audience and can leak.
- **Accessibility is P0** (authored inline in each row/control, not a trailing pass): `accessibilityRole="progressbar"` + `accessibilityValue={{min:0,max:100,now:pct}}` + text fallback; polite announcements only at coarse milestones (0/25/50/75/100), never per-tick; one meaningful `accessibilityLabel` per row; status conveyed by text+icon, never color alone (WCAG 1.4.1); Dynamic Type (`min-height`, `allowFontScaling`, no clipped labels); reduced-motion (`AccessibilityInfo.isReduceMotionEnabled`); WCAG-AA contrast in both light (cream) and dark (midnight-navy) themes; VoiceOver focus moves to the board/new rows after navigation.
- **Pure modules** (`ingest-status.ts`, `progress-throttle.ts`, `upload-progress.ts`, `batch-rollup.ts`, `submit-result.ts`) import ONLY from `bun:test` (in tests) and each other — no React, SQLite, or expo imports — so `bun test src/lib/<file>.test.ts` runs them as plain TS.
- **Shared-tree git hygiene:** reserve files via agent-mail before editing; commit with `git commit -m "…" -- <explicit paths>` (never `git add -A`).
- **Test command:** from `apps/mobile`, `bun test src/lib/<file>.test.ts`.
- **Migration safety:** drizzle migration `0006` must be registered in BOTH `meta/_journal.json` and `migrations.js`, ordered after `0005`; a mis-registration throws in `<DbGate>` before first paint and bricks launch. It is JS/SQL only → OTA-safe.

---

## File Structure

**New pure modules (TDD core, `apps/mobile/src/lib/`):**
- `progress-throttle.ts` — `shouldPersist`, `coarseMilestone`.
- `upload-progress.ts` — in-memory per-row progress emitter (`emitProgress`/`getProgress`/`subscribe`/`clearProgress`).
- `submit-result.ts` — map a server `SubmitOk` (`{deduped, retried}`) → next `PendingStatus`.
- `ingest-status.ts` — unify `(local?, server?)` → `UnifiedView` (status + label + a11yLabel + a11yValue + deepLinkSlug).
- `batch-rollup.ts` — aggregate N per-slot views into one batch `UnifiedView`.

**New tests:** `<module>.test.ts` beside each pure module.

**Modified:**
- `apps/mobile/src/lib/db/schema.ts` — widen `PendingStatus`, add progress columns.
- `apps/mobile/src/lib/db/migrations/0006_optimistic_progress.sql` (+ `meta/_journal.json`, `migrations.js`) — new migration.
- `apps/mobile/src/lib/api.ts` — `uploadFile` → `createUploadTask` + `onProgress`.
- `apps/mobile/src/lib/outbox.ts` — enqueue-only binaries, `sent` state, progress persist, `reconcileSentRows`, dedup handling, JSON `sent`, 4xx→failed, self-heal TTL.
- `apps/mobile/src/lib/ingest-submit.ts` — `retried` on `SubmitOk`; `visibility`/`shareGroupIds` in bodies.
- `apps/mobile/src/lib/materials.ts` — handlers become enqueue-and-return for all kinds.
- `apps/mobile/src/app/(tabs)/composer.tsx` — stage-at-pick-time; non-blocking `runSubmit`/`finishSubmit`; remove Alerts; focus/announce.
- `apps/mobile/src/app/(tabs)/library.tsx` — per-item board rows off `pending_submissions` merged with server, continuum, live bar, dedup controls, batch grouping, reconcile via `useEffect`.
- `apps/mobile/src/components/sirius.tsx` — `StatusPip` continuum + progressbar row.
- `apps/mobile/src/constants/theme.ts` — status pip colors WCAG-AA both themes.
- `apps/mobile/src/lib/a11y.ts` (new) — `useReducedMotion` hook + `announcePolite` helper.

**Secondary (native, last):** `apps/mobile/src/app/(tabs)/library.tsx` + `_layout.tsx` + `help.tsx` + `u/[handle]/catalog.tsx` + `nav.ts`/`nav.test.ts` — `😼ALOG` rename; `package.json` + root `overrides` — `lucide-react-native` + `react-native-svg`.

---

## Task 1: Schema + migration 0006 (prerequisite)

**Files:**
- Modify: `apps/mobile/src/lib/db/schema.ts:38` (PendingStatus union), `:119-160` (pending_submissions table)
- Create: `apps/mobile/src/lib/db/migrations/0006_optimistic_progress.sql`
- Modify: `apps/mobile/src/lib/db/migrations/meta/_journal.json`, `apps/mobile/src/lib/db/migrations.js`

**Interfaces:**
- Produces: `PendingStatus = 'queued' | 'in_flight' | 'sent' | 'failed' | 'deduped'`; new `PendingRow` columns `progressPct: number` (default 0), `progressBytes: number | null`, `progressTotal: number | null`, `phase: string | null`.

- [ ] **Step 1: Verify the current migration tail so 0006 orders correctly**

Run: `ls apps/mobile/src/lib/db/migrations && sed -n '1,40p' apps/mobile/src/lib/db/migrations/meta/_journal.json`
Expected: the highest existing migration is `0005…`; note its journal `idx` and `tag`.

- [ ] **Step 2: Widen the `PendingStatus` union**

In `apps/mobile/src/lib/db/schema.ts:38`, change:
```ts
export type PendingStatus = "queued" | "in_flight" | "failed";
```
to:
```ts
// "sent" = bytes accepted by the server, awaiting the /api/app/queue handoff row.
// "deduped" = server reported an existing post ("Already saved").
export type PendingStatus =
  | "queued"
  | "in_flight"
  | "sent"
  | "failed"
  | "deduped";
```

- [ ] **Step 3: Add progress columns to the `pending_submissions` drizzle table**

In `apps/mobile/src/lib/db/schema.ts` inside the `pending_submissions` `sqliteTable(...)` definition (around :119-160), add these columns (match the file's existing column style):
```ts
  progressPct: integer("progress_pct").notNull().default(0),
  progressBytes: integer("progress_bytes"),
  progressTotal: integer("progress_total"),
  phase: text("phase"),
```

- [ ] **Step 4: Author the migration SQL**

Create `apps/mobile/src/lib/db/migrations/0006_optimistic_progress.sql`:
```sql
ALTER TABLE `pending_submissions` ADD COLUMN `progress_pct` integer DEFAULT 0 NOT NULL;
ALTER TABLE `pending_submissions` ADD COLUMN `progress_bytes` integer;
ALTER TABLE `pending_submissions` ADD COLUMN `progress_total` integer;
ALTER TABLE `pending_submissions` ADD COLUMN `phase` text;
```

- [ ] **Step 5: Register the migration in `_journal.json` and `migrations.js`**

Append a new entry to the `entries` array in `apps/mobile/src/lib/db/migrations/meta/_journal.json` with `idx` = previous + 1, a fixed `when` timestamp (copy the format of the prior entry; do NOT use `Date.now()`), and `tag: "0006_optimistic_progress"`. Then in `apps/mobile/src/lib/db/migrations.js` import and register the new SQL exactly as the existing entries do (follow the file's existing pattern — journal entry + `m0006` mapping).

- [ ] **Step 6: Verify the app boots and the migration applies**

Run: `bun --cwd apps/mobile ios` (or reload if the sim is running). Watch Metro for the migration to run inside `<DbGate>` with no error, and confirm the app renders past first paint.
Expected: no "no such column" errors from any `useLiveQuery` over `pending_submissions`; app launches.

- [ ] **Step 7: Reserve files, then commit**

```bash
git commit -m "feat(mobile): add pending_submissions progress columns + sent/deduped states (migration 0006)" -- \
  apps/mobile/src/lib/db/schema.ts \
  apps/mobile/src/lib/db/migrations/0006_optimistic_progress.sql \
  apps/mobile/src/lib/db/migrations/meta/_journal.json \
  apps/mobile/src/lib/db/migrations.js
```

---

## Task 2: `progress-throttle.ts` (pure)

**Files:**
- Create: `apps/mobile/src/lib/progress-throttle.ts`
- Test: `apps/mobile/src/lib/progress-throttle.test.ts`

**Interfaces:**
- Produces: `shouldPersist(prevPct: number, nextPct: number, prevAtMs: number, nowMs: number): boolean`; `coarseMilestone(pct: number): 0 | 25 | 50 | 75 | 100`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/lib/progress-throttle.test.ts`:
```ts
// Run with: bun test src/lib/progress-throttle.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { coarseMilestone, shouldPersist } from "./progress-throttle";

describe("shouldPersist", () => {
  test("first progress (prevAtMs 0) always persists", () => {
    expect(shouldPersist(0, 1, 0, 500)).toBe(true);
  });
  test("tiny delta within the time window does NOT persist", () => {
    expect(shouldPersist(40, 42, 1_000, 1_200)).toBe(false);
  });
  test(">=5% delta persists even inside the time window", () => {
    expect(shouldPersist(40, 45, 1_000, 1_100)).toBe(true);
  });
  test(">=500ms elapsed persists even on a tiny delta", () => {
    expect(shouldPersist(40, 41, 1_000, 1_600)).toBe(true);
  });
  test("reaching 100 always persists (terminal)", () => {
    expect(shouldPersist(97, 100, 1_000, 1_050)).toBe(true);
  });
});

describe("coarseMilestone", () => {
  test("buckets to 0/25/50/75/100", () => {
    expect(coarseMilestone(0)).toBe(0);
    expect(coarseMilestone(24)).toBe(0);
    expect(coarseMilestone(25)).toBe(25);
    expect(coarseMilestone(60)).toBe(50);
    expect(coarseMilestone(88)).toBe(75);
    expect(coarseMilestone(100)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/progress-throttle.test.ts` (from `apps/mobile`)
Expected: FAIL — cannot find module `./progress-throttle`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/lib/progress-throttle.ts`:
```ts
/** Pure throttling for durable progress writes + accessibility announcements. */

const MIN_DELTA_PCT = 5;
const MIN_INTERVAL_MS = 500;

/** True when a progress tick is worth a SQLite write (durability + AT milestone). */
export function shouldPersist(
  prevPct: number,
  nextPct: number,
  prevAtMs: number,
  nowMs: number,
): boolean {
  if (prevAtMs === 0) return true; // first tick
  if (nextPct >= 100 && prevPct < 100) return true; // terminal
  if (Math.abs(nextPct - prevPct) >= MIN_DELTA_PCT) return true;
  if (nowMs - prevAtMs >= MIN_INTERVAL_MS) return true;
  return false;
}

/** Coarse bucket for polite screen-reader announcements (never per-tick). */
export function coarseMilestone(pct: number): 0 | 25 | 50 | 75 | 100 {
  if (pct >= 100) return 100;
  if (pct >= 75) return 75;
  if (pct >= 50) return 50;
  if (pct >= 25) return 25;
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/progress-throttle.test.ts`
Expected: PASS (7 assertions).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): pure progress-throttle (shouldPersist + coarseMilestone)" -- \
  apps/mobile/src/lib/progress-throttle.ts apps/mobile/src/lib/progress-throttle.test.ts
```

---

## Task 3: `upload-progress.ts` (in-memory emitter)

**Files:**
- Create: `apps/mobile/src/lib/upload-progress.ts`
- Test: `apps/mobile/src/lib/upload-progress.test.ts`

**Interfaces:**
- Produces: `type ProgressSnap = { pct: number; sent: number; total: number }`; `emitProgress(id: string, snap: ProgressSnap): void`; `getProgress(id: string): ProgressSnap | undefined`; `subscribe(id: string, cb: (snap: ProgressSnap) => void): () => void`; `clearProgress(id: string): void`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/lib/upload-progress.test.ts`:
```ts
// Run with: bun test src/lib/upload-progress.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import {
  clearProgress,
  emitProgress,
  getProgress,
  subscribe,
} from "./upload-progress";

describe("upload-progress emitter", () => {
  test("emit then get returns the latest snapshot", () => {
    emitProgress("row1", { pct: 42, sent: 42, total: 100 });
    expect(getProgress("row1")).toEqual({ pct: 42, sent: 42, total: 100 });
  });

  test("subscribers receive emitted snapshots until unsubscribed", () => {
    const seen: number[] = [];
    const off = subscribe("row2", (s) => seen.push(s.pct));
    emitProgress("row2", { pct: 10, sent: 10, total: 100 });
    emitProgress("row2", { pct: 20, sent: 20, total: 100 });
    off();
    emitProgress("row2", { pct: 30, sent: 30, total: 100 });
    expect(seen).toEqual([10, 20]);
  });

  test("clearProgress removes stored state", () => {
    emitProgress("row3", { pct: 99, sent: 99, total: 100 });
    clearProgress("row3");
    expect(getProgress("row3")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/upload-progress.test.ts`
Expected: FAIL — cannot find module `./upload-progress`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/lib/upload-progress.ts`:
```ts
/**
 * In-memory upload progress store keyed by pending_submissions row id.
 * Per-tick progress lives HERE (no SQLite write) so drizzle's table-level
 * useLiveQuery does not re-run the board SELECT on every byte.
 */
export type ProgressSnap = { pct: number; sent: number; total: number };

const snapshots = new Map<string, ProgressSnap>();
const listeners = new Map<string, Set<(snap: ProgressSnap) => void>>();

export function emitProgress(id: string, snap: ProgressSnap): void {
  snapshots.set(id, snap);
  const set = listeners.get(id);
  if (set) for (const cb of set) cb(snap);
}

export function getProgress(id: string): ProgressSnap | undefined {
  return snapshots.get(id);
}

export function subscribe(
  id: string,
  cb: (snap: ProgressSnap) => void,
): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) listeners.delete(id);
  };
}

export function clearProgress(id: string): void {
  snapshots.delete(id);
  listeners.delete(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/upload-progress.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): in-memory upload-progress emitter (per-tick, no SQLite thrash)" -- \
  apps/mobile/src/lib/upload-progress.ts apps/mobile/src/lib/upload-progress.test.ts
```

---

## Task 4: `submit-result.ts` (dedup/retried mapping, pure)

**Files:**
- Create: `apps/mobile/src/lib/submit-result.ts`
- Test: `apps/mobile/src/lib/submit-result.test.ts`

**Interfaces:**
- Produces: `type SubmitResultLite = { ok: boolean; status?: number; deduped?: boolean; retried?: boolean }`; `nextStatusFromResult(r: SubmitResultLite): "sent" | "deduped" | "failed" | "deferred"`. (`"deferred"` = keep as `queued`, retry later.)
- Consumes: `PendingStatus` semantics from Task 1 (string values only).

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/lib/submit-result.test.ts`:
```ts
// Run with: bun test src/lib/submit-result.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { nextStatusFromResult } from "./submit-result";

describe("nextStatusFromResult", () => {
  test("2xx normal -> sent (awaits server handoff)", () => {
    expect(nextStatusFromResult({ ok: true, status: 200 })).toBe("sent");
  });
  test("deduped:true (not retried) -> deduped", () => {
    expect(
      nextStatusFromResult({ ok: true, status: 200, deduped: true }),
    ).toBe("deduped");
  });
  test("retried:true is NEVER dedup -> sent", () => {
    expect(
      nextStatusFromResult({ ok: true, status: 202, retried: true }),
    ).toBe("sent");
  });
  test("deduped AND retried -> sent (retried wins; work re-queued)", () => {
    expect(
      nextStatusFromResult({ ok: true, deduped: true, retried: true }),
    ).toBe("sent");
  });
  test("4xx terminal -> failed", () => {
    expect(nextStatusFromResult({ ok: false, status: 422 })).toBe("failed");
  });
  test("5xx / offline -> deferred (retry later)", () => {
    expect(nextStatusFromResult({ ok: false, status: 503 })).toBe("deferred");
    expect(nextStatusFromResult({ ok: false })).toBe("deferred");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/submit-result.test.ts`
Expected: FAIL — cannot find module `./submit-result`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/lib/submit-result.ts`:
```ts
/** Pure mapping from a server ingest response to the next outbox row status. */
export type SubmitResultLite = {
  ok: boolean;
  status?: number;
  deduped?: boolean;
  retried?: boolean;
};

/**
 * "sent"     -> bytes accepted; keep the row until the server queue row appears.
 * "deduped"  -> existing post ("Already saved"); surface in-board.
 * "failed"   -> terminal client error (4xx); surface in-board as Failed.
 * "deferred" -> transient (5xx/offline); leave queued to auto-retry.
 */
export function nextStatusFromResult(
  r: SubmitResultLite,
): "sent" | "deduped" | "failed" | "deferred" {
  if (r.ok) {
    // retried means the server re-queued previously-failed work: NOT a dedup.
    if (r.deduped && !r.retried) return "deduped";
    return "sent";
  }
  if (typeof r.status === "number" && r.status >= 400 && r.status < 500) {
    return "failed";
  }
  return "deferred";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/submit-result.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): pure submit-result mapping (deduped/retried/4xx/5xx)" -- \
  apps/mobile/src/lib/submit-result.ts apps/mobile/src/lib/submit-result.test.ts
```

---

## Task 5: `ingest-status.ts` (unified continuum, pure)

**Files:**
- Create: `apps/mobile/src/lib/ingest-status.ts`
- Test: `apps/mobile/src/lib/ingest-status.test.ts`

**Interfaces:**
- Consumes: `PendingStatus` (Task 1).
- Produces:
```ts
type UnifiedStatus =
  | "queued" | "uploading" | "received" | "drafting"
  | "done" | "failed" | "already_saved";
type LocalRowLite = { status: PendingStatus; progressPct: number | null };
type ServerRowLite = {
  status: string; // pending|processing|completed|failed|skipped
  startedAt?: string | null;
  resultPostSlug?: string | null;
  errorMessage?: string | null;
};
type UnifiedView = {
  status: UnifiedStatus;
  label: string;              // "Uploading 62%", "Drafting…", "Already saved"
  a11yLabel: string;          // "<descriptor>, <spoken state>"
  a11yValue?: { min: number; max: number; now: number }; // only when uploading
  deepLinkSlug?: string;      // set when done
  errorMessage?: string;
};
function unifyStatus(descriptor: string, local?: LocalRowLite, server?: ServerRowLite): UnifiedView;
```

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/lib/ingest-status.test.ts`:
```ts
// Run with: bun test src/lib/ingest-status.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { unifyStatus } from "./ingest-status";

const D = "my-article.com";

describe("unifyStatus", () => {
  test("queued local, no server", () => {
    const v = unifyStatus(D, { status: "queued", progressPct: 0 });
    expect(v.status).toBe("queued");
    expect(v.label).toBe("Queued");
    expect(v.a11yValue).toBeUndefined();
    expect(v.a11yLabel).toBe("my-article.com, queued");
  });

  test("uploading exposes clamped pct + progressbar value", () => {
    const v = unifyStatus(D, { status: "in_flight", progressPct: 62 });
    expect(v.status).toBe("uploading");
    expect(v.label).toBe("Uploading 62%");
    expect(v.a11yValue).toEqual({ min: 0, max: 100, now: 62 });
    expect(v.a11yLabel).toBe("my-article.com, uploading 62 percent");
  });

  test("uploading with null/NaN pct guards to 0", () => {
    const v = unifyStatus(D, { status: "in_flight", progressPct: null });
    expect(v.label).toBe("Uploading 0%");
    expect(v.a11yValue).toEqual({ min: 0, max: 100, now: 0 });
  });

  test("pct clamps above 100", () => {
    const v = unifyStatus(D, { status: "in_flight", progressPct: 140 });
    expect(v.a11yValue!.now).toBe(100);
  });

  test("local sent -> received", () => {
    const v = unifyStatus(D, { status: "sent", progressPct: 100 });
    expect(v.status).toBe("received");
    expect(v.label).toBe("Received");
  });

  test("server pending -> received", () => {
    const v = unifyStatus(D, undefined, { status: "pending" });
    expect(v.status).toBe("received");
  });

  test("server processing -> drafting", () => {
    const v = unifyStatus(D, undefined, { status: "processing" });
    expect(v.status).toBe("drafting");
    expect(v.label).toBe("Drafting…");
  });

  test("server completed -> done + deepLinkSlug", () => {
    const v = unifyStatus(D, undefined, {
      status: "completed",
      resultPostSlug: "my-article",
    });
    expect(v.status).toBe("done");
    expect(v.label).toBe("Done");
    expect(v.deepLinkSlug).toBe("my-article");
  });

  test("local deduped -> already_saved", () => {
    const v = unifyStatus(D, { status: "deduped", progressPct: 0 });
    expect(v.status).toBe("already_saved");
    expect(v.label).toBe("Already saved");
  });

  test("failed surfaces errorMessage", () => {
    const v = unifyStatus(D, { status: "failed", progressPct: 0 }, {
      status: "failed",
      errorMessage: "file missing",
    });
    expect(v.status).toBe("failed");
    expect(v.label).toBe("Failed");
    expect(v.errorMessage).toBe("file missing");
    expect(v.a11yLabel).toBe("my-article.com, failed — file missing");
  });

  test("server state wins over a local sent row (handoff observed)", () => {
    const v = unifyStatus(
      D,
      { status: "sent", progressPct: 100 },
      { status: "processing" },
    );
    expect(v.status).toBe("drafting");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/ingest-status.test.ts`
Expected: FAIL — cannot find module `./ingest-status`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/lib/ingest-status.ts`:
```ts
import type { PendingStatus } from "./db/schema";

export type UnifiedStatus =
  | "queued"
  | "uploading"
  | "received"
  | "drafting"
  | "done"
  | "failed"
  | "already_saved";

export type LocalRowLite = {
  status: PendingStatus;
  progressPct: number | null;
};

export type ServerRowLite = {
  status: string; // pending | processing | completed | failed | skipped
  startedAt?: string | null;
  resultPostSlug?: string | null;
  errorMessage?: string | null;
};

export type UnifiedView = {
  status: UnifiedStatus;
  label: string;
  a11yLabel: string;
  a11yValue?: { min: number; max: number; now: number };
  deepLinkSlug?: string;
  errorMessage?: string;
};

const SPOKEN: Record<UnifiedStatus, string> = {
  queued: "queued",
  uploading: "uploading",
  received: "received",
  drafting: "drafting",
  done: "done",
  failed: "failed",
  already_saved: "already saved",
};

function clampPct(pct: number | null | undefined): number {
  if (pct == null || Number.isNaN(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Compose the unified continuum from the local outbox row and/or the server
 * queue row. Server state (once present) wins over a local `sent` row because
 * it is the source of truth after handoff. Precedence:
 *   failed > already_saved > done > drafting > received > uploading > queued
 */
export function unifyStatus(
  descriptor: string,
  local?: LocalRowLite,
  server?: ServerRowLite,
): UnifiedView {
  const errorMessage = server?.errorMessage ?? undefined;

  // Terminal failure from either side.
  if (local?.status === "failed" || server?.status === "failed") {
    return {
      status: "failed",
      label: "Failed",
      a11yLabel: errorMessage
        ? `${descriptor}, failed — ${errorMessage}`
        : `${descriptor}, failed`,
      errorMessage,
    };
  }

  // Dedup terminal (local only).
  if (local?.status === "deduped") {
    return build(descriptor, "already_saved", "Already saved");
  }

  // Done (server completed).
  if (server?.status === "completed") {
    return {
      ...build(descriptor, "done", "Done"),
      deepLinkSlug: server.resultPostSlug ?? undefined,
    };
  }

  // Drafting (server actively processing).
  if (server?.status === "processing") {
    return build(descriptor, "drafting", "Drafting…");
  }

  // Received: local bytes accepted OR server row exists as pending.
  if (local?.status === "sent" || server?.status === "pending") {
    return build(descriptor, "received", "Received");
  }

  // Uploading: local in flight with a live pct.
  if (local?.status === "in_flight") {
    const now = clampPct(local.progressPct);
    return {
      status: "uploading",
      label: `Uploading ${now}%`,
      a11yLabel: `${descriptor}, uploading ${now} percent`,
      a11yValue: { min: 0, max: 100, now },
    };
  }

  // Default: queued.
  return build(descriptor, "queued", "Queued");
}

function build(
  descriptor: string,
  status: UnifiedStatus,
  label: string,
): UnifiedView {
  return { status, label, a11yLabel: `${descriptor}, ${SPOKEN[status]}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/ingest-status.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): pure ingest-status unified continuum (local+server -> UnifiedView)" -- \
  apps/mobile/src/lib/ingest-status.ts apps/mobile/src/lib/ingest-status.test.ts
```

---

## Task 6: `batch-rollup.ts` (image-batch aggregation, pure)

**Files:**
- Create: `apps/mobile/src/lib/batch-rollup.ts`
- Test: `apps/mobile/src/lib/batch-rollup.test.ts`

**Interfaces:**
- Consumes: `UnifiedStatus`, `UnifiedView` (Task 5).
- Produces: `type SlotStatus = UnifiedStatus`; `rollupBatch(count: number, slots: { status: UnifiedStatus; pct: number }[]): { status: UnifiedStatus; pct: number; label: string }`. Label form: `"<count> photos, <state>"` for a11y and `"N photos"` descriptor.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/lib/batch-rollup.test.ts`:
```ts
// Run with: bun test src/lib/batch-rollup.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { rollupBatch } from "./batch-rollup";

describe("rollupBatch", () => {
  test("any uploading -> uploading with min pct (conservative bar)", () => {
    const r = rollupBatch(3, [
      { status: "uploading", pct: 80 },
      { status: "uploading", pct: 30 },
      { status: "received", pct: 100 },
    ]);
    expect(r.status).toBe("uploading");
    expect(r.pct).toBe(30);
    expect(r.label).toBe("3 photos, uploading 30 percent");
  });

  test("all received/pending -> received", () => {
    const r = rollupBatch(2, [
      { status: "received", pct: 100 },
      { status: "received", pct: 100 },
    ]);
    expect(r.status).toBe("received");
    expect(r.label).toBe("2 photos, received");
  });

  test("any drafting (and none uploading) -> drafting", () => {
    const r = rollupBatch(2, [
      { status: "drafting", pct: 100 },
      { status: "received", pct: 100 },
    ]);
    expect(r.status).toBe("drafting");
  });

  test("all done -> done", () => {
    const r = rollupBatch(2, [
      { status: "done", pct: 100 },
      { status: "done", pct: 100 },
    ]);
    expect(r.status).toBe("done");
  });

  test("any failed slot -> failed immediately (do not wait for server)", () => {
    const r = rollupBatch(3, [
      { status: "uploading", pct: 50 },
      { status: "failed", pct: 0 },
      { status: "received", pct: 100 },
    ]);
    expect(r.status).toBe("failed");
    expect(r.label).toBe("3 photos, failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/batch-rollup.test.ts`
Expected: FAIL — cannot find module `./batch-rollup`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/lib/batch-rollup.ts`:
```ts
import type { UnifiedStatus } from "./ingest-status";

type Slot = { status: UnifiedStatus; pct: number };

/**
 * Aggregate N per-slot statuses of one image batch into a single board item.
 * Weakest-slot wins so the batch never over-reports progress:
 *   failed > uploading > received > drafting > done
 * (failed short-circuits; uploading before received so a still-uploading slot
 * holds the batch at "uploading"; drafting/done only once every slot is past
 * upload.)
 */
export function rollupBatch(
  count: number,
  slots: Slot[],
): { status: UnifiedStatus; pct: number; label: string } {
  const noun = `${count} photos`;

  if (slots.some((s) => s.status === "failed")) {
    return { status: "failed", pct: 0, label: `${noun}, failed` };
  }
  if (slots.some((s) => s.status === "uploading")) {
    const pct = Math.min(
      ...slots.map((s) => (s.status === "uploading" ? s.pct : 100)),
    );
    return {
      status: "uploading",
      pct,
      label: `${noun}, uploading ${pct} percent`,
    };
  }
  if (slots.some((s) => s.status === "received" || s.status === "queued")) {
    return { status: "received", pct: 100, label: `${noun}, received` };
  }
  if (slots.some((s) => s.status === "drafting")) {
    return { status: "drafting", pct: 100, label: `${noun}, drafting` };
  }
  if (slots.length > 0 && slots.every((s) => s.status === "done")) {
    return { status: "done", pct: 100, label: `${noun}, done` };
  }
  return { status: "received", pct: 100, label: `${noun}, received` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/batch-rollup.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): pure batch-rollup for image-batch board aggregation" -- \
  apps/mobile/src/lib/batch-rollup.ts apps/mobile/src/lib/batch-rollup.test.ts
```

---

## Task 7: `api.ts` — live upload progress via `createUploadTask`

**Files:**
- Modify: `apps/mobile/src/lib/api.ts:1` (import), `:344-366` (`uploadFile`)

**Interfaces:**
- Consumes: `ProgressSnap` (Task 3, but keep `api.ts` free of the emitter — accept a callback).
- Produces: `uploadFile(url, fileUri, opts, onProgress?)` where `onProgress?: (p: { pct: number; sent: number; total: number }) => void`; the return type and `parseUploadResult` behavior are unchanged; also returns a `cancel: () => Promise<void>` for future use OR keeps the current return and exposes cancel via a param — pick the minimal change that preserves callers.

- [ ] **Step 1: Read the current `uploadFile` + its imports**

Run: `sed -n '1,10p;338,370p' apps/mobile/src/lib/api.ts`
Expected: confirm the legacy `expo-file-system` import and the `uploadAsync(...)` call and its `options` object (Cookie header, `fieldName`, `mimeType`, `parameters`, `httpMethod`, `uploadType`).

- [ ] **Step 2: Switch the import to the legacy submodule that exposes `createUploadTask`**

At `apps/mobile/src/lib/api.ts:1`, ensure the file imports `createUploadTask` (and whatever `FileSystemUploadType`/types it already uses) from `expo-file-system/legacy`:
```ts
import { createUploadTask, FileSystemUploadType } from "expo-file-system/legacy";
```
(If the file already imports other names from `expo-file-system`, consolidate them to `expo-file-system/legacy` — `uploadAsync`/`createUploadTask` both live there in SDK 56.)

- [ ] **Step 3: Rewrite the `uploadFile` body to use `createUploadTask` with a progress callback**

Replace the `uploadAsync(...)` call inside `uploadFile` (api.ts:344-366) — keep the surrounding `runWithAuthRetry` + `parseUploadResult` + the exact `options` object — with:
```ts
export async function uploadFile(
  url: string,
  fileUri: string,
  options: /* keep existing options type */ UploadFileOptions,
  onProgress?: (p: { pct: number; sent: number; total: number }) => void,
) {
  return runWithAuthRetry(async (headers) => {
    const task = createUploadTask(
      url,
      fileUri,
      {
        // ...keep the existing options object verbatim (httpMethod, uploadType,
        // fieldName, mimeType, parameters, headers: { ...headers, Cookie }) ...
      },
      (data) => {
        const total = data.totalBytesExpectedToSend;
        const sent = data.totalBytesSent;
        const pct = total > 0 ? Math.round((100 * sent) / total) : 0;
        onProgress?.({ pct, sent, total });
      },
    );
    const result = await task.uploadAsync();
    return parseUploadResult(result); // unchanged
  });
}
```
Notes: `createUploadTask(url, fileUri, options, callback)` returns a task; `task.uploadAsync()` resolves to the same `FileSystemUploadResult` `parseUploadResult` already consumes. Do not change `parseUploadResult`. The `MULTIPART` upload type stays exactly as before.

- [ ] **Step 4: Typecheck**

Run: `bun run check-types` (from repo root) — or `turbo check-types --filter=mobile`.
Expected: no new type errors in `api.ts`. (Bust turbo cache with `--force` if it reports FULL TURBO without recompiling.)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): uploadFile live progress via createUploadTask (legacy fs)" -- \
  apps/mobile/src/lib/api.ts
```

---

## Task 8: `ingest-submit.ts` — `retried` + audience fields

**Files:**
- Modify: `apps/mobile/src/lib/ingest-submit.ts:15-23` (`SubmitOk`), the `urlIngestBody`/`noteIngestBody` builders (:31-125)

**Interfaces:**
- Consumes: server response `{deduped, retried}` (submit.ts:114-146).
- Produces: `SubmitOk` gains `retried?: boolean`; `OutboxBody`/`requestJson` for url/note includes `visibility` and `shareGroupIds`.

- [ ] **Step 1: Confirm the current direct-POST body carries audience**

Run: `sed -n '1,130p' apps/mobile/src/lib/ingest-submit.ts`
Expected: identify where `visibility` and `shareGroupIds` are (or are NOT) placed on the url/note request body today, and where `deduped` is read from the response.

- [ ] **Step 2: Add `retried` to `SubmitOk`**

At `apps/mobile/src/lib/ingest-submit.ts:15-23`, extend the type:
```ts
export type SubmitOk = {
  ok: true;
  id: string;
  deduped?: boolean;
  retried?: boolean; // server re-queued previously-failed work (submit.ts:114-146)
  // ...existing fields...
};
```
And where the response is parsed, read `retried` off the JSON alongside `deduped`.

- [ ] **Step 3: Ensure the ingest body includes `visibility` + `shareGroupIds`**

In `urlIngestBody`/`noteIngestBody` (and wherever `OutboxBody.requestJson` is assembled), include the caller-provided audience so the outbox JSON replay POSTs the identical body:
```ts
function urlIngestBody(input: {
  url: string;
  force?: boolean;
  localId: string;
  visibility: PostVisibility;      // PRIVATE | FRIENDS | PUBLIC
  shareGroupIds: string[];
}) {
  return {
    kind: "url",
    url: input.url,
    force: input.force ?? false,
    localId: input.localId,
    visibility: input.visibility,
    shareGroupIds: input.shareGroupIds,
  };
}
```
(Do the same for `noteIngestBody`.) If these fields were already present, this step is a no-op verification — but they MUST be in `requestJson`, not only passed to the old direct POST.

- [ ] **Step 4: Typecheck**

Run: `bun run check-types`
Expected: no new errors; callers in `materials.ts` now must pass `visibility`/`shareGroupIds` (fixed in Task 10).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): thread retried + preserve visibility/shareGroupIds in ingest bodies" -- \
  apps/mobile/src/lib/ingest-submit.ts
```

---

## Task 9: `outbox.ts` — enqueue/send split, `sent` state, progress, reconcile, dedup, self-heal

**Files:**
- Modify: `apps/mobile/src/lib/outbox.ts` — `sendBinaryRow` (:175-231), `flushOutbox` JSON branch (:373-396), plus new exports `reconcileSentRows`, `markRowSent`, `persistProgress`.

**Interfaces:**
- Consumes: `nextStatusFromResult` (Task 4), `shouldPersist`/`coarseMilestone` (Task 2), `emitProgress`/`clearProgress` (Task 3), `uploadFile(..., onProgress)` (Task 7).
- Produces: `reconcileSentRows(serverSubmissionIds: Set<string>): Promise<void>` (deletes `sent` rows whose linked submission id is now observed on the server, in any state; calls `discardStagedCopy`; `clearProgress`); on 2xx `sendBinaryRow` sets `sent` (not delete); on `deduped` sets `deduped`; a 4xx sets `failed`; the JSON branch mirrors all of this.

- [ ] **Step 1: Convert binary success from delete → `sent`, add progress plumbing**

In `sendBinaryRow` (outbox.ts:175-231): set `in_flight` before upload (unchanged); pass an `onProgress` to `uploadFile` that:
```ts
let prevPct = 0;
let prevAt = 0;
const res = await uploadFile(url, row.localFilePath, opts, ({ pct, sent, total }) => {
  emitProgress(row.id, { pct, sent, total });
  const now = Date.now();
  if (shouldPersist(prevPct, pct, prevAt, now)) {
    prevPct = pct;
    prevAt = now;
    // durable write ONLY at milestones (table-level useLiveQuery re-runs board)
    void db.update(pendingSubmissions)
      .set({ progressPct: pct, progressBytes: sent, progressTotal: total })
      .where(eq(pendingSubmissions.id, row.id));
  }
});
```
Then map the outcome with `nextStatusFromResult`:
```ts
const next = nextStatusFromResult({ ok: res.ok, status: res.status, deduped: res.deduped, retried: res.retried });
if (next === "sent") {
  await db.update(pendingSubmissions)
    .set({ status: "sent", progressPct: 100, serverSubmissionId: res.id ?? null })
    .where(eq(pendingSubmissions.id, row.id));
  // keep staged bytes until reconcileSentRows sees the server row
} else if (next === "deduped") {
  await markRowDeduped(row); // sets status "deduped"; do NOT link submission id
} else if (next === "failed") {
  await db.update(pendingSubmissions).set({ status: "failed", lastError: res.errorMessage ?? "upload failed" }).where(eq(pendingSubmissions.id, row.id));
  clearProgress(row.id);
} else {
  await db.update(pendingSubmissions).set({ status: "queued" }).where(eq(pendingSubmissions.id, row.id)); // deferred
}
```
(Note: `serverSubmissionId` — if the schema has no such column, store the server id in the existing linkage field used by the board; if none exists, add `server_submission_id text` to Task 1's migration and schema. Choose the existing field if one already links a row to its server submission; otherwise extend the migration.)

- [ ] **Step 2: Mirror the same in the JSON/ingest branch of `flushOutbox`**

At `flushOutbox` (outbox.ts:373-396): the ingest branch currently POSTs `/api/app/ingest` and DROPS a 4xx. Replace with the same `nextStatusFromResult` mapping: 2xx → `sent` (keep row, store `serverSubmissionId`); `deduped:true && !retried` → `deduped`; 4xx → `failed` (in-board, no longer silently dropped); 5xx/offline → leave `queued`.

- [ ] **Step 3: Add `reconcileSentRows`**

Append to `outbox.ts`:
```ts
/** Delete local rows already handed off to the server (any server state). */
export async function reconcileSentRows(serverSubmissionIds: Set<string>): Promise<void> {
  const sentRows = await db.select().from(pendingSubmissions)
    .where(eq(pendingSubmissions.status, "sent"));
  for (const row of sentRows) {
    if (row.serverSubmissionId && serverSubmissionIds.has(row.serverSubmissionId)) {
      await discardStagedCopy(row);
      clearProgress(row.id);
      await db.delete(pendingSubmissions).where(eq(pendingSubmissions.id, row.id));
    }
  }
}
```

- [ ] **Step 4: Add a self-heal TTL for stuck `sent` rows**

Add a bounded fallback so a stale-cookie 401 on the queue poll cannot strand a `sent` row forever (bytes are already server-side, so dropping the local row cannot lose data):
```ts
const SENT_TTL_MS = 2 * 60 * 1000;
export async function sweepStuckSentRows(nowMs: number): Promise<void> {
  const sentRows = await db.select().from(pendingSubmissions)
    .where(eq(pendingSubmissions.status, "sent"));
  for (const row of sentRows) {
    if (nowMs - new Date(row.updatedAt ?? row.createdAt).getTime() > SENT_TTL_MS) {
      await discardStagedCopy(row);
      clearProgress(row.id);
      await db.delete(pendingSubmissions).where(eq(pendingSubmissions.id, row.id));
    }
  }
}
```
Call `sweepStuckSentRows(Date.now())` at the top of `flushOutbox`.

- [ ] **Step 5: Add `markRowDeduped` (no submission link)**

```ts
async function markRowDeduped(row: PendingRow): Promise<void> {
  await discardStagedCopy(row); // deduped means server already has the post
  clearProgress(row.id);
  await db.update(pendingSubmissions).set({ status: "deduped" }).where(eq(pendingSubmissions.id, row.id));
  // Deliberately do NOT set serverSubmissionId: keep the card purely local so
  // the delta-pull reconcile cannot absorb the "Already saved" terminal.
}
```

- [ ] **Step 6: Typecheck + boot**

Run: `bun run check-types` then reload the app.
Expected: compiles; existing outbox flow still uploads a binary and the row transitions to `sent` then disappears once the server poll observes it (verified fully in Task 12).

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(mobile): outbox enqueue/send split, sent state, throttled progress, reconcile + self-heal" -- \
  apps/mobile/src/lib/outbox.ts
```

---

## Task 10: `materials.ts` — enqueue-and-return handlers for all kinds

**Files:**
- Modify: `apps/mobile/src/lib/materials.ts` — url/repo/note handlers (:370-499), image/video/audio/document handlers (:558-777), `submitMaterials` (:811-877)

**Interfaces:**
- Consumes: `enqueueOutbox` / `enqueueBinary` (outbox.ts), `urlIngestBody`/`noteIngestBody` w/ audience (Task 8), optimistic posts-mirror card creation (existing note plumbing :487-499).
- Produces: handlers return `{submitted:0, queued:n, deduped:[], failed}` — dedup no longer resolved synchronously; each returns after fast local writes only.

- [ ] **Step 1: url/repo/note → `enqueueOutbox` (no network await)**

Replace `apiPostJson('/api/app/ingest')` in the url/repo/note handlers with:
```ts
const body = urlIngestBody({ url, force, localId, visibility, shareGroupIds });
await enqueueOutbox(body, localId);
createOptimisticPostCard(localId, /* kind, title/url */); // reuse note plumbing (materials.ts:487-499) for url too
return { submitted: 0, queued: 1, deduped: [], errors: [], failed: [] };
```
Remove the synchronous `deduped[]` push + optimistic-draft delete (materials.ts:376-386/469-477/421-423) — dedup is now surfaced in-board by the flush.

- [ ] **Step 2: image/video/audio/document → `enqueueBinary` only (no send, no await)**

Replace `enqueueAndSendBinary(...)` in the four binary handlers with `enqueueBinary(...)` (durable row only) and always create the optimistic posts card:
```ts
await enqueueBinary({ transport, localId, batchId, imageIndex, totalCount, localFilePath: stagedPath, mimeType, /* visibility, shareGroupIds if applicable */ });
createOptimisticPostCard(localId, /* kind */);
return { submitted: 0, queued: 1, deduped: [], errors: [], failed: [] };
```
The pre-condition: `stagedPath` is an app-private OUTBOX copy (guaranteed by Task 11's stage-at-pick-time). Keep the existing enqueue-throw → `failed.push` catch (materials.ts:584-592 etc.).

- [ ] **Step 3: `submitMaterials` returns accepted counts**

`submitMaterials` (:811-877) already aggregates handler results; confirm it now returns `queued` totals with an empty `deduped[]`. No structural change beyond the handlers.

- [ ] **Step 4: Typecheck**

Run: `bun run check-types`
Expected: callers of the url/note handlers now supply `visibility`/`shareGroupIds` (composer already has these from the AudiencePicker); fix any missing plumbing in composer call sites (Task 11).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): materials handlers enqueue-and-return for all kinds (optimistic)" -- \
  apps/mobile/src/lib/materials.ts
```

---

## Task 11: `composer.tsx` — stage-at-pick-time + non-blocking submit

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/composer.tsx` — `stageAndAddAssets` (:288-332), `runSubmit`/`submit`/`finishSubmit` (:642-761), remove the pre-stage loop (:706-716) and the Alerts (:663-666, :740-758)
- Create: `apps/mobile/src/lib/a11y.ts` (`useReducedMotion`, `announcePolite`)

**Interfaces:**
- Consumes: `isStagedPath` (outbox.ts helper — add if absent), `announcePolite` (a11y.ts).
- Produces: submit path with no awaited network; every enqueued binary row points at an OUTBOX-staged copy.

- [ ] **Step 1: Stage bytes at PICK time (data-loss fix)**

In `stageAndAddAssets` (composer.tsx:288-332), make `stageBinaryCopy` awaited when the asset is added (it already copies into `outbox/<id>/`). Mark the tray item non-submittable (a per-item `staging: true` flag) until its staged path resolves; flip the item to submittable with `localFilePath = stagedPath` on success. On staging failure, keep the tray card and surface an inline error (do NOT enqueue). Add `isStagedPath(path)` guard usage so only OUTBOX paths are ever enqueued.

- [ ] **Step 2: Remove the blocking pre-stage loop**

Delete the pre-submit loop at composer.tsx:706-716 (it re-staged un-staged binaries synchronously) — staging is now guaranteed at pick time. `trayErrors.hasCritical` should include "an item is still staging" so Process is disabled until staging completes (fast, local).

- [ ] **Step 3: Make `runSubmit`/`finishSubmit` non-blocking**

Rewrite `runSubmit` (composer.tsx:642-658) so `busy` covers only the synchronous enqueue (tens of ms), then `finishSubmit` navigates immediately:
```ts
async function runSubmit(materials: Material[], force = false) {
  setBusy(true);
  try {
    const result = await submitMaterials(materials, { force }); // local writes only now
    return result;
  } finally {
    setBusy(false);
  }
}
```
In `finishSubmit` (661-681): keep `pushOnce('/(tabs)/library')`, `invalidateQueries(['queue'])` + `(['posts'])`, `kickSync('submit')`. DELETE the "Saved on this device" Alert (663-666).

- [ ] **Step 4: Remove the synchronous dedup Alert**

In `submit()` (693-761), delete the dedup Alert block (740-758). `forceReprocess` (684-691) stays as the handler the board's "Process again" control calls (Task 12). Add, right after navigation, a polite announcement + focus hand-off:
```ts
announcePolite(`Capture queued, ${count} item${count === 1 ? "" : "s"} uploading`);
```

- [ ] **Step 5: Create `a11y.ts`**

Create `apps/mobile/src/lib/a11y.ts`:
```ts
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Announce via the platform screen reader (polite; safe no-op if AT is off). */
export function announcePolite(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}

/** Track the OS "Reduce Motion" setting to render static progress fills. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduced(v));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
```

- [ ] **Step 6: Typecheck + manual smoke**

Run: `bun run check-types`, then reload. Tap Process on a note: button returns immediately, screen routes to the board, the note appears as a row. (Full continuum verified in Task 12.)
Expected: no long spinner; instant navigation.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(mobile): non-blocking optimistic submit + stage-at-pick-time + a11y helpers" -- \
  apps/mobile/src/app/(tabs)/composer.tsx apps/mobile/src/lib/a11y.ts
```

---

## Task 12: `library.tsx` + `sirius.tsx` — per-item board, live bar, dedup controls, reconcile

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/library.tsx` — In-flight section (:468-716), local live query (:187-206), server query (:116-140)
- Modify: `apps/mobile/src/components/sirius.tsx` — `StatusPip` (:166-174) + a new `ProgressRow`

**Interfaces:**
- Consumes: `unifyStatus` (Task 5), `rollupBatch` (Task 6), `subscribe`/`getProgress` (Task 3), `reconcileSentRows`/`sweepStuckSentRows` (Task 9), `forceReprocess` (composer), `useReducedMotion` (Task 11).
- Produces: the board renders one row per item (url/note/single-file/batch) walking the continuum.

- [ ] **Step 1: Render per-item rows through `unifyStatus`**

Replace the collapsed "N items uploading/waiting" banner (library.tsx:478-504) with a per-item list. For each local row (and merged server row by `serverSubmissionId`), compute `unifyStatus(descriptor, local, server)`. Group image batches by `batchId` and pass their slot views through `rollupBatch`. Use `describeSubmission()` (:50-64) for the `descriptor`. Render `StatusPip` with the label from `unifyStatus` (never color alone).

- [ ] **Step 2: Add a live progress bar bound to the emitter**

In `sirius.tsx`, add a `ProgressRow` that subscribes to `upload-progress` for the row id so the bar animates per-tick WITHOUT re-running the board query:
```tsx
export function ProgressRow({ id, view }: { id: string; view: UnifiedView }) {
  const reduced = useReducedMotion();
  const [pct, setPct] = useState(view.a11yValue?.now ?? getProgress(id)?.pct ?? 0);
  useEffect(() => subscribe(id, (s) => setPct(s.pct)), [id]);
  if (view.status !== "uploading") return null;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityLabel={`${view.a11yLabel}`}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }, reduced && styles.fillStatic]} />
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Polite milestone announcements**

When a row's `coarseMilestone(pct)` changes, call `announcePolite(view.a11yLabel)` (guard so it fires once per bucket, never per-tick).

- [ ] **Step 4: In-board dedup row controls**

For `status === "already_saved"`, render two `Pressable`s (`accessibilityRole="button"`, distinct labels/hints), reusing the failed-row Requeue/Discard layout (library.tsx:505-531):
- **Process again** → `forceReprocess(materialFor(row))` (enqueues a fresh `force:true` row + card), then delete the deduped row.
- **Dismiss** → delete the deduped row (`markPostDeduped` cleanup).

- [ ] **Step 5: Drive reconcile off query DATA (react-query v5 fix)**

The server query stays `useQuery(['queue'])` polled every 5s. Add:
```tsx
useEffect(() => {
  if (!queueData) return;
  const ids = new Set(queueData.items.map((i) => i.id));
  void reconcileSentRows(ids);
  void sweepStuckSentRows(Date.now());
}, [queueData]);
```
Do NOT use `onSuccess`. Also, from the submit path (Task 11 `kickSync`) trigger an immediate `queryClient.invalidateQueries({ queryKey: ['queue'] })` so the handoff refetch happens promptly.

- [ ] **Step 6: `StatusPip` continuum + non-color state**

Extend `StatusPip` (sirius.tsx:166-174) so every `UnifiedStatus` maps to a dot color + an always-present text label; the color is never the sole signal. Pull colors from `submissionStatusPip()` (Task 14).

- [ ] **Step 7: Typecheck + full continuum smoke (agent-device / manual)**

Run: `bun run check-types`, reload, then per `scripts/testing/MOBILE-E2E.md`: submit a URL, a note, a large image, a video; watch Process return instantly and each row walk **Queued → Uploading NN% → Received → Drafting… → Done**; repeat a URL to see **Already saved** + Process again; background mid-video to see **Paused — resumes when you reopen**.
Expected: continuum renders; no duplicate (local + server) rows; no flicker.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(mobile): In-flight board per-item continuum + live bar + in-board dedup + reconcile" -- \
  apps/mobile/src/app/(tabs)/library.tsx apps/mobile/src/components/sirius.tsx
```

---

## Task 13: `theme.ts` — WCAG-AA status pip colors (both themes)

**Files:**
- Modify: `apps/mobile/src/constants/theme.ts:329-337` (`submissionStatusPip`)

**Interfaces:**
- Consumes: `UnifiedStatus` (Task 5).
- Produces: `submissionStatusPip(status: UnifiedStatus, theme)` returning an AA-contrast color per status in BOTH light (cream) and dark (midnight-navy) palettes.

- [ ] **Step 1: Extend the color map to the full continuum**

Update `submissionStatusPip()` to cover `queued | uploading | received | drafting | done | failed | already_saved` with distinct hues that meet WCAG AA (≥3:1 for the pip vs surface; ≥4.5:1 for adjacent label text) in both themes. Reuse existing tokens (`inkSubtle`, `accent`, `sage`, `danger`, `inkFaint`) and add one for `already_saved` (e.g. a muted amber that passes AA on cream AND navy).

- [ ] **Step 2: Verify contrast**

Compute contrast ratios for each pip/label pair against both `surface` colors (use the theme token hexes). Document the ratios in a code comment. If any pair fails AA, choose a compliant token.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(mobile): WCAG-AA status pip colors across the ingest continuum (both themes)" -- \
  apps/mobile/src/constants/theme.ts
```

---

## Task 14: Full-suite regression + typecheck + lint gate

**Files:** none (verification).

- [ ] **Step 1: Run every new pure suite**

Run (from `apps/mobile`):
```bash
bun test src/lib/progress-throttle.test.ts \
  src/lib/upload-progress.test.ts \
  src/lib/submit-result.test.ts \
  src/lib/ingest-status.test.ts \
  src/lib/batch-rollup.test.ts \
  src/lib/nav.test.ts
```
Expected: all PASS (the existing `nav.test.ts` must still pass — no regressions).

- [ ] **Step 2: Typecheck + lint (bust turbo cache)**

Run: `bun run check-types --force` and `bun run lint --force` (from repo root).
Expected: 0 errors, 0 warnings for `mobile`. If turbo reports FULL TURBO without recompiling changed files, re-run with `--force` before trusting the result.

- [ ] **Step 3: Device continuum verification**

Follow `scripts/testing/MOBILE-E2E.md` for the four-material continuum + dedup + background-pause scenarios from Task 12 Step 7. Record outcomes; note the harness cannot reproduce sub-second timing (progress throttling is covered by the pure suite instead).

- [ ] **Step 4: Commit (if any lint/type fixups were needed)**

```bash
git commit -m "chore(mobile): typecheck/lint fixups for optimistic ingestion" -- <changed files>
```

---

## Task 15 (SECONDARY, LAST, NATIVE): `😼ALOG` cat-pun rename

> Do this only after Tasks 1–14 ship OTA and are verified. This is the ONLY task that requires a native rebuild.

**Files:**
- Modify: root `package.json` `overrides` + `apps/mobile/package.json` deps (`lucide-react-native`, `react-native-svg` pinned)
- Modify: `apps/mobile/src/app/(tabs)/library.tsx` (header title + eyebrow), `apps/mobile/src/app/(tabs)/_layout.tsx:61` (tab label), and the back-title strings (`library.tsx:341-342`, `u/[handle]/catalog.tsx:163`, `_layout.tsx:284,314,365`, `help.tsx:134-135`)
- Modify: `apps/mobile/src/lib/nav.test.ts` fixtures (back-title compared literally)

**Interfaces:**
- Produces: visible `😼ALOG` wordmark (cat glyph + legible "Catalog") with `accessibilityLabel` ALWAYS "Catalog"; the icon is decorative.

- [ ] **Step 1: Add deps (pinned) and prebuild-gate awareness**

Add `react-native-svg` + `lucide-react-native` at pinned versions to `apps/mobile/package.json` and root `overrides` (match the repo's pinning convention). Run `bun install`. Confirm `bun run verify:native-ai` stays green (this rename must not disturb the llama.rn gate).

- [ ] **Step 2: Render the wordmark with a decorative `<Cat/>` icon**

In `library.tsx` header/eyebrow, render an inline `lucide-react-native` `<Cat/>` icon followed by the legible word, and set `accessibilityLabel="Catalog"` on the header; mark the icon `importantForAccessibility="no"` / `accessibilityElementsHidden`. Keep the tab-bar text and back-titles legible ("Catalog"); the cat is a flourish, never the sole carrier of meaning.

- [ ] **Step 3: Update `nav.test.ts` fixtures**

Update any literal `from=Catalog` fixtures only if the back-title string changes; keep them consistent with the code.

- [ ] **Step 4: Prebuild + native build**

Run: `bun run mobile:build:preview:ios` (or the appropriate profile). Confirm the native build succeeds with the new `react-native-svg` autolinked and `verify:native-ai` green. Do NOT commit `ios/`/`android/`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): 😼ALOG cat wordmark (lucide Cat + react-native-svg); Catalog stays legible + a11y" -- \
  package.json apps/mobile/package.json bun.lock \
  apps/mobile/src/app/(tabs)/library.tsx apps/mobile/src/app/(tabs)/_layout.tsx \
  apps/mobile/src/app/_layout.tsx apps/mobile/src/app/help.tsx \
  apps/mobile/src/app/u/[handle]/catalog.tsx apps/mobile/src/lib/nav.test.ts
```

---

## Self-Review (completed by author)

**Spec coverage:** §4.1 non-blocking submit → Tasks 10, 11; §4.2 continuum → Task 5 (+12); §4.3 progress plumbing → Tasks 3, 7, 9; §4.4 in-board dedup → Tasks 4, 9, 12; §4.5 handoff/no-flicker → Task 9 (`reconcileSentRows`, self-heal) + Task 12 (`useEffect` on `queueData`); §4.6 background honesty → Task 12 Step 7 presentation; §4.7 batch aggregation → Task 6 (+12); §4.8 accessibility → Tasks 11 (`a11y.ts`), 12 (progressbar/announce/reduced-motion), 13 (contrast); §4.9 data model → Task 1; §5 data-loss staging → Task 11 Step 1; privacy audience → Task 8 Step 3; §7 rollout → task ordering + Task 15 isolation.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows code. Two deliberate "confirm existing field / choose existing linkage else extend migration" decisions (Task 8 Step 3 audience presence; Task 9 Step 1 `serverSubmissionId` column) are verification-then-act, not placeholders — each states the fallback (add the field) explicitly.

**Type consistency:** `PendingStatus` (Task 1) reused everywhere; `UnifiedStatus`/`UnifiedView` defined in Task 5 and consumed by Tasks 6, 12, 13; `nextStatusFromResult` values (`sent|deduped|failed|deferred`) map onto Task 9's writes; `ProgressSnap` shape (`{pct,sent,total}`) identical in Tasks 3, 7, 9, 12.
