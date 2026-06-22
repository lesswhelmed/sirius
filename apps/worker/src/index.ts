// Long-running daemon: poll the IngestSubmission table, claim a row (or a full
// image batch once totalCount rows are present), run the pipeline, mark the
// row(s) completed or failed. Run with `bun run start` (see README).
import { setTimeout as sleep } from "node:timers/promises";
import {
  claimNextArchiveRequest,
  claimNextNonImage,
  claimNextSceneRecompute,
  claimReadyImageBatch,
  completeSceneRecompute,
  failSceneRecompute,
  findPostBySourceRecordId,
  heartbeatProcessing,
  type IngestSubmission,
  markCompleted,
  markFailed,
  notifyPostChanged,
  reclaimStaleImageBatches,
  reclaimStaleProcessing,
  reclaimStaleSceneRecomputes,
  recordRetainedOriginal,
} from "@repo/db";
import { processArchiveRequest } from "./archive/run-archive";
import { recomputeOwnerScene } from "./scene/recompute";
import { retainOriginal } from "./lib/originals";
import { removeStagedFile } from "./lib/staging";
import { processIngest } from "./pipeline/pipeline";
import type { PipelineInput, StagedImage } from "./pipeline/types";

const DEFAULT_POLL_MS = 5000;
const DEFAULT_LEASE_MS = 600_000; // 10 min before a stuck "processing" row is reclaimed
const DEFAULT_MAX_ATTEMPTS = 3; // dead-letter after this many processing attempts

let shuttingDown = false;

function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>,
) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[ingest-worker] [${level}] ${msg}${payload}`);
}

function pollInterval(): number {
  const raw = process.env.INGEST_POLL_INTERVAL_MS;
  if (!raw) {
    return DEFAULT_POLL_MS;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_MS;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function leaseMs(): number {
  return envInt("INGEST_LEASE_MS", DEFAULT_LEASE_MS);
}

function maxAttempts(): number {
  return envInt("INGEST_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS);
}

// Stable identity for a claim, matching the non-frontmatter branch of
// getSourceRecordId in post-writer.ts: image batches key on the batchId, single
// url/note rows key on their own id.
function sourceRecordIdFor(rows: IngestSubmission[]): string {
  const first = rows[0];
  if (!first) {
    return "";
  }
  if (first.kind === "image" && first.batchId) {
    return `batch:${first.batchId}`;
  }
  return first.id;
}

// Nudge connected mobile clients that a post just landed (see @repo/db notify.ts
// + the /api/app/posts/stream SSE route). Best-effort and fire-and-forget: a
// failed NOTIFY must never fail the ingest that triggered it, and the client's
// delta pull would heal a missed nudge anyway.
function emitPostChange(args: {
  postId: string;
  slug: string;
  rows: IngestSubmission[];
  sourceRecordId: string;
}): void {
  void notifyPostChanged({
    op: "upsert",
    postId: args.postId,
    slug: args.slug,
    ownerId: args.rows[0]?.submittedById ?? null,
    sourceRecordId: args.sourceRecordId || null,
    updatedAt: new Date().toISOString(),
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "notify-failed", { slug: args.slug, error: message });
  });
}

// Resurrect rows stranded in "processing" by a hard-killed worker. Best-effort:
// a DB hiccup here must not crash the daemon.
// Time an image batch may sit with missing uploads before it's abandoned. The
// web composer submits all rows of a batch within one request burst, so a batch
// that's still short of totalCount after this window will never complete.
const DEFAULT_BATCH_ASSEMBLY_MS = 1_800_000; // 30 min

function batchAssemblyMs(): number {
  return envInt("INGEST_BATCH_ASSEMBLY_MS", DEFAULT_BATCH_ASSEMBLY_MS);
}

async function runReclaim(): Promise<void> {
  try {
    const result = await reclaimStaleProcessing({
      leaseMs: leaseMs(),
      maxAttempts: maxAttempts(),
    });
    if (result.requeued > 0 || result.deadLettered > 0) {
      log("info", "reclaim", {
        requeued: result.requeued,
        deadLettered: result.deadLettered,
      });
    }
    const staleBatchRows = await reclaimStaleImageBatches(batchAssemblyMs());
    if (staleBatchRows > 0) {
      log("info", "reclaim-image-batches", { failedRows: staleBatchRows });
    }
    const staleScenes = await reclaimStaleSceneRecomputes(leaseMs());
    if (staleScenes > 0) {
      log("info", "reclaim-scene-recomputes", { requeued: staleScenes });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "reclaim error", { error: message });
  }
}

type PayloadShape = {
  urls?: unknown;
  notes?: unknown;
  force?: unknown;
  contentType?: unknown;
  extension?: unknown;
  draft?: unknown;
};

function readPayload(submission: IngestSubmission): PayloadShape {
  const p = submission.payload;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return p as PayloadShape;
  }
  return {};
}

// Filename used for a retained original within its submission dir. Image batch
// rows are numbered by their position (1.jpg, 2.jpg, …); single-file kinds keep
// a stable "original.<ext>". Extension comes from the submit-time payload.
function buildOriginalFilename(row: IngestSubmission): string {
  const payload = readPayload(row);
  const fallbackExt = row.kind === "image" ? "jpg" : "bin";
  const extension =
    typeof payload.extension === "string" && payload.extension
      ? payload.extension
      : fallbackExt;
  if (row.kind === "image") {
    return `${(row.imageIndex ?? 0) + 1}.${extension}`;
  }
  return `original.${extension}`;
}

// Moves a successfully-processed row's staged binary into the private originals
// store and records where it landed. Best-effort: a retain failure logs but must
// not fail the already-written post (the original is just unavailable to
// download, no worse than a missed cleanup). Rows without a staged binary
// (url/note) are skipped.
async function retainRowOriginals(rows: IngestSubmission[]): Promise<void> {
  for (const row of rows) {
    if (!row.stagedFilePath) {
      continue;
    }
    try {
      const filename = buildOriginalFilename(row);
      const retained = retainOriginal({
        submittedById: row.submittedById,
        submissionId: row.id,
        stagedFilePath: row.stagedFilePath,
        filename,
      });
      const payload = readPayload(row);
      await recordRetainedOriginal(row.id, {
        retainedFilePath: retained.path,
        originalMimeType:
          typeof payload.contentType === "string" ? payload.contentType : null,
        originalSizeBytes: retained.sizeBytes,
        originalFilename: filename,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "retain-failed", { id: row.id, error: message });
    }
  }
}

function buildInput(rows: IngestSubmission[]): PipelineInput {
  const first = rows[0];
  if (!first) {
    throw new Error("no rows to process");
  }
  const submittedById = first.submittedById ?? null;
  const projectId = first.projectId ?? null;
  if (first.kind === "image") {
    if (!first.batchId) {
      throw new Error(`image row ${first.id} missing batchId`);
    }
    const images: StagedImage[] = rows
      .filter((r) => r.stagedFilePath && r.imageIndex != null)
      .map((r) => {
        const payload = readPayload(r) as { extension?: unknown };
        const extension =
          typeof payload.extension === "string" ? payload.extension : "jpg";
        return {
          submissionId: r.id,
          index: r.imageIndex ?? 0,
          stagedFilePath: r.stagedFilePath as string,
          extension,
        };
      })
      .sort((a, b) => a.index - b.index);
    const firstPayload = readPayload(first);
    const notes = (firstPayload.notes as string | undefined) ?? "";
    return {
      kind: "image",
      submissions: rows,
      batchId: first.batchId,
      notes,
      // Draft rides on every image row (same as notes); rows[0] wins.
      draft: firstPayload.draft,
      images,
      submittedById,
      projectId,
    };
  }
  const payload = readPayload(first);
  const notes = typeof payload.notes === "string" ? payload.notes : "";
  if (first.kind === "url") {
    const urls = Array.isArray(payload.urls)
      ? (payload.urls as unknown[]).filter(
          (u): u is string => typeof u === "string",
        )
      : [];
    const force = payload.force === true;
    return {
      kind: "url",
      submission: first,
      urls,
      notes,
      force,
      draft: payload.draft,
      submittedById,
      projectId,
    };
  }
  if (first.kind === "note") {
    return {
      kind: "note",
      submission: first,
      notes,
      draft: payload.draft,
      submittedById,
      projectId,
    };
  }
  // New single-file kinds: video, audio, document. Reference-only — each is one
  // submission carrying a stagedFilePath that the worker hands to Gemini.
  if (
    first.kind === "video" ||
    first.kind === "audio" ||
    first.kind === "document"
  ) {
    if (!first.stagedFilePath) {
      throw new Error(`${first.kind} row ${first.id} missing stagedFilePath`);
    }
    const mimeType =
      typeof payload.contentType === "string"
        ? payload.contentType
        : "application/octet-stream";
    const extension =
      typeof payload.extension === "string" ? payload.extension : "bin";
    return {
      kind: first.kind,
      submission: first,
      stagedFilePath: first.stagedFilePath,
      mimeType,
      extension,
      notes,
      submittedById,
      projectId,
    };
  }
  throw new Error(`unknown kind: ${first.kind}`);
}

async function processBatch(rows: IngestSubmission[]): Promise<void> {
  const ids = rows.map((r) => r.id);
  const kind = rows[0]?.kind;
  const batchId = rows[0]?.batchId ?? null;
  log("info", "processing", { ids, kind, batchId });
  try {
    // Idempotency: if this submission already produced a post (e.g. a prior
    // attempt crashed after writePost but before markCompleted), reuse it
    // instead of re-running Gemini — unless the row is flagged to force a
    // regenerate.
    const force = rows.some((r) => r.force);
    if (!force) {
      const sourceRecordId = sourceRecordIdFor(rows);
      const existing = sourceRecordId
        ? await findPostBySourceRecordId(sourceRecordId)
        : null;
      if (existing) {
        await markCompleted(ids, {
          resultPostSlug: existing.slug,
          resultPostId: existing.id,
        });
        // The original was already retained on the first successful run; this
        // deduped re-submit just drops its staged copy.
        for (const row of rows) {
          removeStagedFile(row.stagedFilePath);
        }
        // Still nudge: a retried/deduped submit means the client may be holding
        // an optimistic row waiting to reconcile against this existing post.
        emitPostChange({
          postId: existing.id,
          slug: existing.slug,
          rows,
          sourceRecordId: sourceRecordId ?? "",
        });
        log("info", "idempotent-skip", { ids, slug: existing.slug });
        return;
      }
    }
    const input = buildInput(rows);
    // Escalate the log level for non-fatal failure stages (e.g. `org:warn`,
    // `org:error`) so a worker silently writing no scene rows is visible in
    // prod logs/alerting instead of buried at info alongside every step.
    const stageLogger = (stage: string, extra?: Record<string, unknown>) => {
      const level = stage.endsWith(":error")
        ? "error"
        : stage.endsWith(":warn")
          ? "warn"
          : "info";
      log(level, `stage:${stage}`, { ids, ...(extra ?? {}) });
    };
    // Keep the lease fresh while a long job runs so the reclaimer doesn't treat
    // a still-running job as crashed. Cleared in `finally`.
    const heartbeatEvery = Math.max(5_000, Math.floor(leaseMs() / 3));
    const heartbeat = setInterval(() => {
      void heartbeatProcessing(ids).catch(() => {});
    }, heartbeatEvery);
    try {
      const result = await processIngest(input, stageLogger);
      await markCompleted(ids, {
        resultPostSlug: result.postSlug,
        resultPostId: result.postId,
      });
      // Retention: keep the uploaded originals instead of deleting them, so the
      // owner can download them later. Done after markCompleted (the post is
      // already written; retention is best-effort and never fails the job).
      await retainRowOriginals(rows);
      emitPostChange({
        postId: result.postId,
        slug: result.postSlug,
        rows,
        sourceRecordId: sourceRecordIdFor(rows),
      });
      log("info", "completed", {
        ids,
        postSlug: result.postSlug,
        postId: result.postId,
      });
    } finally {
      clearInterval(heartbeat);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "failed", { ids, error: message });
    await markFailed(ids, message);
  }
}

async function tick(): Promise<boolean> {
  const single = await claimNextNonImage();
  if (single) {
    await processBatch([single]);
    return true;
  }
  const batch = await claimReadyImageBatch();
  if (batch.length > 0) {
    await processBatch(batch);
    return true;
  }
  const archiveReq = await claimNextArchiveRequest();
  if (archiveReq) {
    try {
      await processArchiveRequest(archiveReq, (msg, extra) =>
        log("info", msg, extra),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "archive-failed", { id: archiveReq.id, error: message });
    }
    return true;
  }
  // Lowest priority: rebuild a stale scene cache (kNN + force layout). Failures
  // self-retry via failSceneRecompute; success deletes the request row.
  const sceneReq = await claimNextSceneRecompute();
  if (sceneReq) {
    try {
      const result = await recomputeOwnerScene(sceneReq.userId);
      await completeSceneRecompute(sceneReq.id);
      log("info", "scene-recompute", {
        userId: sceneReq.userId,
        nodes: result.nodes,
        neighbors: result.neighbors,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failSceneRecompute(sceneReq.id, message);
      log("error", "scene-recompute-failed", {
        id: sceneReq.id,
        error: message,
      });
    }
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  const interval = pollInterval();
  log("info", "started", {
    pollIntervalMs: interval,
    leaseMs: leaseMs(),
    maxAttempts: maxAttempts(),
  });
  process.on("SIGINT", () => {
    log("info", "SIGINT received; exiting after current tick");
    shuttingDown = true;
  });
  process.on("SIGTERM", () => {
    log("info", "SIGTERM received; exiting after current tick");
    shuttingDown = true;
  });

  // Recover anything a previously-killed worker left stuck in "processing".
  await runReclaim();

  while (!shuttingDown) {
    let didWork = false;
    try {
      await runReclaim();
      didWork = await tick();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "tick error", { error: message });
    }
    if (shuttingDown) {
      break;
    }
    if (!didWork) {
      await sleep(interval);
    }
  }
  log("info", "shutdown complete");
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "fatal", { error: message });
    process.exit(1);
  });
}
