// Offline outbox for all ingest submissions. Notes/URLs (pure JSON) are queued
// and flushed on the next connectivity trigger — capture works fully offline.
// Binary kinds (images, files) are now also persisted: stageBinaryCopy() copies
// bytes into an app-private dir before the upload, so a kill mid-upload leaves a
// recoverable row that flushOutbox() resumes.
//
// Backed by the local SQLite `pending_submissions` table (the unified outbox),
// NOT the old outbox.json file. This module keeps its original public API as a
// thin wrapper so existing call sites keep working; the on-launch
// importLegacyOutboxOnce() migrates any leftover outbox.json rows once, then
// deletes the file.
//
// Idempotency: the server dedups by contentHash (urls + notes), so an item that
// actually reached the server before the connection dropped simply dedupes when
// retried.

import { asc, eq } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  readDirectoryAsync,
} from "expo-file-system/legacy";

import { ApiError, apiPostJson, uploadFile } from "@/lib/api";
import { db } from "@/lib/db/client";
import { type PendingRow, pendingSubmissions } from "@/lib/db/schema";
import type { SubmitOk } from "@/lib/ingest-submit";
import { linkSubmission, markPostFailedByLocalId } from "@/lib/sync/writes";

// App-private root for staged binary copies. One subdir per staged/queued file
// (`outbox/<id>/<filename>`), so deleting the subdir removes the whole copy.
const OUTBOX_DIR = `${documentDirectory}outbox`;

// The two binary transports route to different endpoints; notes use "ingest".
type BinaryTransport = "ingest-image" | "ingest-file";
function endpointFor(t: BinaryTransport): string {
  return t === "ingest-image" ? "/api/app/ingest-images" : "/api/app/ingest-file";
}

// Exact JSON body for POST /api/app/ingest.
export type OutboxBody = {
  urls: string[];
  notes: string;
  force: boolean;
  projectId?: string;
  draft?: unknown;
};

export type OutboxItem = {
  id: string;
  createdAt: string;
  attempts: number;
  body: OutboxBody;
};

// Enqueue a note/url ingest body for later replay. `localId` links the queued
// submission to its optimistic post row once that exists (Step 4); standalone
// enqueues (today's path) get a fresh id with no post yet.
export async function enqueueOutbox(
  body: OutboxBody,
  localId: string = randomUUID(),
): Promise<void> {
  await db.insert(pendingSubmissions).values({
    id: randomUUID(),
    localId,
    transport: "ingest",
    requestJson: body,
    attempts: 0,
    status: "queued",
    createdAt: new Date(),
  });
}

async function countOutbox(): Promise<number> {
  const rows = await db
    .select({ id: pendingSubmissions.id })
    .from(pendingSubmissions)
    .where(eq(pendingSubmissions.status, "queued"));
  return rows.length;
}

// Copy a picked file's bytes into the app-private outbox so the upload survives
// the picker cache being evicted (and a force-quit). Returns the durable path,
// which the composer stores as the material's uri and later enqueues.
export async function stageBinaryCopy(
  srcUri: string,
  fileName: string,
): Promise<string> {
  const id = randomUUID();
  const dir = `${OUTBOX_DIR}/${id}`;
  await makeDirectoryAsync(dir, { intermediates: true });
  const dest = `${dir}/${fileName}`;
  await copyAsync({ from: srcUri, to: dest });
  return dest;
}

// True when a path is one of our durable outbox copies (vs a raw picker/camera
// temp uri). Lets the composer skip re-staging an already-durable asset and
// avoid a double copy. Mirrors discardStagedCopy's prefix guard.
export function isStagedPath(path: string | null | undefined): boolean {
  return !!path && path.startsWith(`${OUTBOX_DIR}/`);
}

// Delete a staged copy (its whole `outbox/<id>/` dir). Safe to call with a
// non-outbox path (e.g. a raw picker uri) — it no-ops unless the path is ours.
export async function discardStagedCopy(
  localFilePath: string | null | undefined,
): Promise<void> {
  if (!localFilePath || !localFilePath.startsWith(`${OUTBOX_DIR}/`)) return;
  const dir = localFilePath.slice(0, localFilePath.lastIndexOf("/"));
  await deleteAsync(dir, { idempotent: true });
}

export type EnqueueBinaryInput = {
  transport: BinaryTransport;
  // Links to an optimistic posts.localId (on-device SIGHT draft) or a fresh id.
  localId: string;
  // The app-private copy produced by stageBinaryCopy.
  localFilePath: string;
  fieldName: string; // "image" | "file"
  mimeType: string;
  parameters: Record<string, string>; // batchId/imageIndex/totalCount/notes/draft
  batchId?: string;
  imageIndex?: number;
  totalCount?: number;
};

// Persist a binary upload as a durable queued row BEFORE the network call, so a
// kill mid-upload leaves a recoverable row. requestJson mirrors uploadFile's args.
// Returns the inserted row so the caller can send it immediately without a re-read.
async function enqueueBinary(input: EnqueueBinaryInput): Promise<PendingRow> {
  const row: PendingRow = {
    id: randomUUID(),
    localId: input.localId,
    transport: input.transport,
    requestJson: {
      fileUri: input.localFilePath,
      fieldName: input.fieldName,
      mimeType: input.mimeType,
      parameters: input.parameters,
    },
    batchId: input.batchId ?? null,
    imageIndex: input.imageIndex ?? null,
    totalCount: input.totalCount ?? null,
    localFilePath: input.localFilePath,
    attempts: 0,
    status: "queued",
    lastError: null,
    nextAttemptAt: null,
    createdAt: new Date(),
    progressPct: 0,
    progressBytes: null,
    progressTotal: null,
    phase: null,
  };
  await db.insert(pendingSubmissions).values(row);
  return row;
}

// Wire shape stored in requestJson for a binary row.
type BinaryRequest = {
  fileUri: string;
  fieldName: string;
  mimeType?: string;
  parameters?: Record<string, string>;
};

// Upload one binary row. Marks it in_flight for the UI while uploading, then:
//   sent     → bytes reached the server; row + on-disk copy deleted.
//   failed   → terminal rejection (4xx) or missing file; row kept as `failed`
//              (file kept) so the user can Requeue/Discard from the Queue tab.
//   deferred → offline / 5xx; row reset to `queued` so it auto-resumes on the
//              next lifecycle trigger. Re-sends are idempotent (server contentHash).
async function sendBinaryRow(
  row: PendingRow,
): Promise<"sent" | "failed" | "deferred"> {
  const req = row.requestJson as BinaryRequest;
  const path = row.localFilePath ?? req.fileUri;

  // The copy is gone (e.g. user cleared app data) — can't ever succeed.
  if (!path || !(await getInfoAsync(path)).exists) {
    await db
      .update(pendingSubmissions)
      .set({ status: "failed", lastError: "file missing" })
      .where(eq(pendingSubmissions.id, row.id));
    return "failed";
  }

  await db
    .update(pendingSubmissions)
    .set({ status: "in_flight" })
    .where(eq(pendingSubmissions.id, row.id));

  try {
    await uploadFile<SubmitOk>(
      endpointFor(row.transport as BinaryTransport),
      path,
      {
        fieldName: req.fieldName,
        mimeType: req.mimeType,
        parameters: req.parameters,
      },
    );
    await discardStagedCopy(row.localFilePath);
    await db.delete(pendingSubmissions).where(eq(pendingSubmissions.id, row.id));
    return "sent";
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      await db
        .update(pendingSubmissions)
        .set({
          status: "failed",
          attempts: row.attempts + 1,
          lastError: `rejected (${err.status})`,
        })
        .where(eq(pendingSubmissions.id, row.id));
      return "failed";
    }
    await db
      .update(pendingSubmissions)
      .set({
        status: "queued",
        attempts: row.attempts + 1,
        lastError:
          err instanceof ApiError ? `server error (${err.status})` : "no connection",
      })
      .where(eq(pendingSubmissions.id, row.id));
    return "deferred";
  }
}

// Enqueue a durable row AND send it now (the Submit path). The row persists
// throughout the upload, so a kill mid-upload is recoverable; the return value
// lets the caller tally sent / deferred(queued) / failed.
export async function enqueueAndSendBinary(
  input: EnqueueBinaryInput,
): Promise<"sent" | "failed" | "deferred"> {
  const row = await enqueueBinary(input);
  return sendBinaryRow(row);
}

// Manual Requeue from the Queue tab: a failed row gets a clean slate and is
// retried on the next flush.
export async function requeueSubmission(id: string): Promise<void> {
  await db
    .update(pendingSubmissions)
    .set({ status: "queued", attempts: 0, lastError: null })
    .where(eq(pendingSubmissions.id, id));
}

// Discard a failed/abandoned row and its on-disk copy.
export async function discardSubmission(id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(pendingSubmissions)
    .where(eq(pendingSubmissions.id, id))
    .limit(1);
  if (row) await discardStagedCopy(row.localFilePath);
  await db.delete(pendingSubmissions).where(eq(pendingSubmissions.id, id));
  // If this was the LAST live row of an image batch, the worker can never write
  // the post (it needs all totalCount rows), so the optimistic SIGHT card would
  // hang `pending` forever — fail it. No-op for non-batch rows (no linked post).
  if (row?.batchId) {
    const siblings = await db
      .select({ id: pendingSubmissions.id })
      .from(pendingSubmissions)
      .where(eq(pendingSubmissions.batchId, row.batchId));
    if (siblings.length === 0) {
      await markPostFailedByLocalId(row.localId);
    }
  }
}

// Once per launch: delete `outbox/<id>/` dirs that no pending row references.
// Covers a kill BEFORE Submit (bytes copied at staging, but the tray — and thus
// any row — never persisted). Runs at the cold-start flush, before the user can
// stage anything this session, so it can't race a live tray entry.
let sweptOrphans = false;
async function sweepOrphanUploadsOnce(): Promise<void> {
  if (sweptOrphans) return;
  sweptOrphans = true;
  try {
    if (!(await getInfoAsync(OUTBOX_DIR)).exists) return;
    const dirs = await readDirectoryAsync(OUTBOX_DIR);
    if (dirs.length === 0) return;
    const rows = await db
      .select({ localFilePath: pendingSubmissions.localFilePath })
      .from(pendingSubmissions);
    const liveDirs = new Set(
      rows
        .map((r) => r.localFilePath)
        .filter((p): p is string => p != null && p.startsWith(`${OUTBOX_DIR}/`))
        .map((p) => p.slice(`${OUTBOX_DIR}/`.length).split("/")[0]),
    );
    for (const dir of dirs) {
      if (!liveDirs.has(dir)) {
        await deleteAsync(`${OUTBOX_DIR}/${dir}`, { idempotent: true });
      }
    }
  } catch (err) {
    console.warn("[outbox] orphan sweep failed", err);
  }
}

// One-time migration of a leftover outbox.json into pending_submissions. Safe to
// call repeatedly: it no-ops once the file is gone. Runs before the first flush.
const LEGACY_OUTBOX_PATH = `${documentDirectory}outbox.json`;
let legacyImported = false;

async function importLegacyOutboxOnce(): Promise<void> {
  if (legacyImported) return;
  legacyImported = true;
  try {
    const info = await getInfoAsync(LEGACY_OUTBOX_PATH);
    if (!info.exists) return;
    const raw = await readAsStringAsync(LEGACY_OUTBOX_PATH);
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
    for (const item of items) {
      if (!item?.body) continue;
      await db.insert(pendingSubmissions).values({
        id: randomUUID(),
        localId: randomUUID(),
        transport: "ingest",
        requestJson: item.body,
        attempts: item.attempts ?? 0,
        status: "queued",
        createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
      });
    }
    await deleteAsync(LEGACY_OUTBOX_PATH, { idempotent: true });
  } catch (err) {
    console.warn("[outbox] legacy outbox.json import failed", err);
  }
}

let flushing: Promise<{ sent: number; remaining: number }> | null = null;

// Sends all queued items FIFO (notes/URLs and binaries). A 4xx response on an
// ingest row means the item can never succeed — it's dropped. For binaries, 4xx
// marks the row `failed` (visible in Queue tab for Requeue/Discard). A network
// failure or 5xx stops the flush; the item stays queued for the next trigger
// (app start, connectivity change, next successful submit). Serialized so
// overlapping triggers don't double-send.
export function flushOutbox(): Promise<{ sent: number; remaining: number }> {
  if (flushing) {
    return flushing;
  }
  flushing = (async () => {
    // A row left `in_flight` can only be a previous flush that was killed
    // mid-upload (flushes are single-flight) — reset it so it re-sends.
    await db
      .update(pendingSubmissions)
      .set({ status: "queued" })
      .where(eq(pendingSubmissions.status, "in_flight"));
    await sweepOrphanUploadsOnce();
    await importLegacyOutboxOnce();
    let sent = 0;
    // Re-read the head each iteration so newly enqueued items are picked up and
    // deletions are reflected without juggling an in-memory copy.
    for (;;) {
      const [row] = await db
        .select()
        .from(pendingSubmissions)
        .where(eq(pendingSubmissions.status, "queued"))
        .orderBy(asc(pendingSubmissions.createdAt))
        .limit(1);
      if (!row) break;

      if (row.transport === "ingest") {
        try {
          const ok = await apiPostJson<SubmitOk>(
            "/api/app/ingest",
            // requestJson is JSON-shaped by construction; apiPostJson's Json type
            // can't see through the stored `unknown`.
            row.requestJson as Parameters<typeof apiPostJson>[1],
          );
          // Link the optimistic post row (if this submission came from an
          // on-device draft) to its server submission, so the canonical post
          // reconciles back into the same card. No-op for standalone enqueues.
          await linkSubmission(row.localId, ok.id);
          sent++;
          await db
            .delete(pendingSubmissions)
            .where(eq(pendingSubmissions.id, row.id));
        } catch (err) {
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
            // Permanent rejection — retrying forever won't heal a 4xx.
            console.warn(
              `[outbox] dropping rejected item (${err.status}): ${err.message}`,
            );
            await db
              .delete(pendingSubmissions)
              .where(eq(pendingSubmissions.id, row.id));
            continue;
          }
          // Offline or server trouble: keep the item, try again on a later trigger.
          await db
            .update(pendingSubmissions)
            .set({
              attempts: row.attempts + 1,
              lastError:
                err instanceof ApiError
                  ? `server error (${err.status})`
                  : "no connection",
            })
            .where(eq(pendingSubmissions.id, row.id));
          break;
        }
      } else {
        // Binary row (ingest-image / ingest-file).
        const result = await sendBinaryRow(row);
        if (result === "sent") sent++;
        // "failed" → row is now `failed` (skipped by the queued query) → continue.
        if (result === "deferred") break; // offline — stop, resume on next trigger.
      }
    }
    const remaining = await countOutbox();
    return { sent, remaining };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
