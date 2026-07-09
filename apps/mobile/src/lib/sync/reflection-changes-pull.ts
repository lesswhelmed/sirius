// Delta catch-up pull for the reflection layer — the reflection analogue of
// comment-changes-pull.ts. Reads the local watermark (newest server updatedAt
// applied across BOTH prompt and response tables — the feed shares one
// cursor), pages GET /api/app/reflections/changes, reconciles each change, and
// advances the watermark only after a page is applied. Idempotent and
// resumable (reconcile is an upsert-by-serverId).
import { eq } from "drizzle-orm";

import { apiGet } from "@/lib/api";
import { db } from "@/lib/db/client";
import { syncMeta } from "@/lib/db/schema";
import type { ReflectionChangesResult } from "./events";
import { currentSyncGeneration } from "./generation";
import {
  applyReflectionPromptTombstone,
  applyReflectionResponseDelete,
  reconcileReflectionPromptUpsert,
  reconcileReflectionResponseUpsert,
} from "./reflection-reconcile";

const SINCE_KEY = "reflections.changes.since.v1";
const EPOCH = new Date(0).toISOString();

async function getSince(): Promise<string> {
  const [row] = await db
    .select()
    .from(syncMeta)
    .where(eq(syncMeta.key, SINCE_KEY))
    .limit(1);
  return row?.value ?? EPOCH;
}

async function setSince(value: string): Promise<void> {
  // The cursor MUST bind as a SQLite TEXT value. better-fetch (authClient.$fetch)
  // revives ISO-8601 date strings in the JSON response into `Date` OBJECTS, so
  // `result.nextCursor` — though typed `string` — arrives as a Date at runtime.
  // expo-sqlite cannot bind a Date (no case in bindStatementParam →
  // InvalidConvertibleException), which would throw uncaught here and stall the
  // cursor forever (the exact bug comment-changes-pull.ts hit). The per-row
  // reconcile writes survive because their Dates land on timestamp_ms columns
  // whose drizzle mappers coerce them; the syncMeta `value` text column has no
  // such mapper, so coerce explicitly.
  const raw: unknown = value;
  const text = raw instanceof Date ? raw.toISOString() : String(raw);
  await db
    .insert(syncMeta)
    .values({ key: SINCE_KEY, value: text })
    .onConflictDoUpdate({ target: syncMeta.key, set: { value: text } });
}

let pulling: Promise<void> | null = null;

// Lets the local-store reset (db/owner.ts) await an in-flight pull before
// wiping (see changes-pull.ts's whenPostPullIdle). Never rejects.
export function whenReflectionPullIdle(): Promise<void> {
  return pulling
    ? pulling.then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
}

// Serialized: overlapping triggers (SSE nudge + foreground + network) share one
// in-flight pull rather than racing the cursor.
export function pullReflectionChanges(): Promise<void> {
  if (pulling) return pulling;
  pulling = (async () => {
    // Abort as soon as the local store is reset (account switch) — see
    // changes-pull.ts for the rationale. Checked before every write.
    const gen = currentSyncGeneration();
    const stale = () => gen !== currentSyncGeneration();
    for (;;) {
      if (stale()) return;
      const since = await getSince();
      const qs = new URLSearchParams({ since, limit: "200" });
      const result = await apiGet<ReflectionChangesResult>(
        `/api/app/reflections/changes?${qs.toString()}`,
      );
      if (stale()) return;
      // Prompts before responses so a brand-new prompt+answer pair arriving in
      // one page renders coherently (a response never waits on its prompt).
      // Per-row failures are isolated so one malformed change can't abort the
      // whole page (which would stall the cursor) — log + skip; reconcile is an
      // idempotent upsert-by-serverId and the cursor still advances.
      for (const change of result.promptChanges) {
        if (stale()) return;
        try {
          if (change.op === "upsert") {
            await reconcileReflectionPromptUpsert(change.prompt);
          } else {
            await applyReflectionPromptTombstone(change.id, change.deletedAt);
          }
        } catch (err) {
          const id = change.op === "upsert" ? change.prompt.id : change.id;
          console.warn(`[sync] skipped reflection prompt change ${id}`, err);
        }
      }
      for (const change of result.responseChanges) {
        if (stale()) return;
        try {
          if (change.op === "upsert") {
            await reconcileReflectionResponseUpsert(change.response);
          } else {
            await applyReflectionResponseDelete(change.id);
          }
        } catch (err) {
          const id = change.op === "upsert" ? change.response.id : change.id;
          console.warn(`[sync] skipped reflection response change ${id}`, err);
        }
      }
      // Never write the cursor into a store that was reset mid-page.
      if (stale()) return;
      if (result.nextCursor) {
        await setSince(result.nextCursor);
      }
      const applied =
        result.promptChanges.length + result.responseChanges.length;
      if (!result.hasMore || applied === 0) break;
    }
  })().finally(() => {
    pulling = null;
  });
  return pulling;
}
