// Long-running daemon: poll the IngestSubmission table, claim a row (or a full
// image batch once totalCount rows are present), run the pipeline, mark the
// row(s) completed or failed. Run with `bun run start` (see README).
import { setTimeout as sleep } from "node:timers/promises";
import {
  claimNextArchiveRequest,
  claimNextNonImage,
  claimNextSceneRecompute,
  claimReadyImageBatch,
  completeAiGenerationReservationForSource,
  completeSceneRecompute,
  failSceneRecompute,
  findPostBySourceRecordId,
  heartbeatProcessing,
  type ArchiveRequest,
  type IngestSubmission,
  markCompleted,
  markFailed,
  markFlagged,
  notifyPostChanged,
  notifySubmissionRejected,
  reclaimStaleArchiveRequests,
  reclaimStaleImageBatches,
  reclaimStaleProcessing,
  reclaimStaleSceneRecomputes,
  recordModerationEvent,
  recordRetainedOriginal,
} from "@repo/db";
import {
  processArchiveRequest,
  sweepExpiredArchiveZipFiles,
} from "./archive/run-archive";
import { recomputeOwnerScene } from "./scene/recompute";
import { retainOriginal } from "./lib/originals";
import { removeStagedFile } from "./lib/staging";
import { processIngest } from "./pipeline/pipeline";
import {
  getSafetyConfig,
  quarantineOriginal,
  SafetyFlagError,
  sendSafetyAlert,
} from "./pipeline/safety";
import type { PipelineInput, StagedImage } from "./pipeline/types";

const DEFAULT_POLL_MS = 5000;
const DEFAULT_LEASE_MS = 600_000; // 10 min before a stuck "processing" row is reclaimed
const DEFAULT_MAX_ATTEMPTS = 3; // dead-letter after this many processing attempts
const DEFAULT_WORKER_CONCURRENCY = 2;
const MAX_WORKER_CONCURRENCY = 8;
const DEFAULT_SHUTDOWN_DRAIN_MS = 30_000;

let shuttingDown = false;
let wakeShutdown: (() => void) | null = null;

function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>,
) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[ingest-worker] [${level}] ${msg}${payload}`);
}

function requestShutdown(signal: "SIGINT" | "SIGTERM"): void {
  log("info", `${signal} received; exiting after active jobs drain`);
  shuttingDown = true;
  wakeShutdown?.();
  wakeShutdown = null;
}

async function waitForShutdownSignal(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  await new Promise<void>((resolve) => {
    wakeShutdown = resolve;
  });
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

function workerConcurrency(): number {
  return Math.min(
    envInt("INGEST_WORKER_CONCURRENCY", DEFAULT_WORKER_CONCURRENCY),
    MAX_WORKER_CONCURRENCY,
  );
}

function shutdownDrainMs(): number {
  return envInt("INGEST_SHUTDOWN_DRAIN_MS", DEFAULT_SHUTDOWN_DRAIN_MS);
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
    const archiveResult = await reclaimStaleArchiveRequests({
      leaseMs: leaseMs(),
      maxAttempts: maxAttempts(),
    });
    if (archiveResult.requeued > 0 || archiveResult.deadLettered > 0) {
      log("info", "reclaim-archives", {
        requeued: archiveResult.requeued,
        deadLettered: archiveResult.deadLettered,
      });
    }
    // Unlink expired archive zips from disk every tick (the download route flips
    // rows to expired but never removes the file) so ARCHIVES_DIR stays bounded
    // even on a low-traffic instance that isn't building new archives.
    const sweptZips = await sweepExpiredArchiveZipFiles((msg, extra) =>
      log("info", msg, extra),
    );
    if (sweptZips > 0) {
      log("info", "reclaim-archive-zips", { removed: sweptZips });
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

// Terminal handling for a content-safety flag. Decoupled from the normal
// success/fail paths: NO post is created, the original is MOVED to quarantine
// (evidence — never deleted), a ModerationEvent audit row is written, the admin
// is alerted, the submission(s) are marked `flagged` (non-retryable), and the
// device is nudged to drop its optimistic row. Every side-effect is best-effort
// around the two that MUST happen (quarantine + markFlagged); an alert/notify
// failure is logged but never resurrects the content.
async function handleSafetyFlag(
  rows: IngestSubmission[],
  error: SafetyFlagError,
): Promise<void> {
  const ids = rows.map((r) => r.id);
  const anchor = rows[0]!;
  const cfg = getSafetyConfig();

  // 1. Quarantine any staged binaries (images/docs/audio/video/fetched-PDF).
  //    url/note rows have no binary — their text evidence stays in the retained
  //    (flagged) submission.payload, so there's nothing to move.
  const quarantinePaths: string[] = [];
  for (const row of rows) {
    if (!row.stagedFilePath) continue;
    try {
      const moved = quarantineOriginal({
        submittedById: row.submittedById,
        submissionId: row.id,
        stagedFilePath: row.stagedFilePath,
        filename: buildOriginalFilename(row),
      });
      quarantinePaths.push(moved.path);
    } catch (e) {
      log("error", "quarantine-failed", {
        id: row.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 2. Alert the admin (best-effort; capture emailedAt only on success).
  let emailedAt: Date | null = null;
  try {
    await sendSafetyAlert({
      alertEmail: cfg.alertEmail,
      action: error.action,
      verdict: error.verdict,
      kind: anchor.kind,
      submissionIds: ids,
      submittedById: anchor.submittedById,
      quarantinePaths,
      model: cfg.model,
    });
    emailedAt = new Date();
  } catch (e) {
    log("error", "safety-alert-failed", {
      ids,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 3. Audit row (CYA) keyed off the anchor submission.
  try {
    await recordModerationEvent({
      submissionId: anchor.id,
      submittedById: anchor.submittedById,
      kind: anchor.kind,
      action: error.action,
      severity: error.verdict.severity,
      categories: error.verdict.categories,
      rationale: error.verdict.rationale,
      model: cfg.model,
      contentHash: anchor.contentHash,
      quarantinePaths,
      emailedAt,
    });
  } catch (e) {
    log("error", "moderation-event-failed", {
      ids,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 4. Terminal flag (non-retryable) — must happen so the row never reprocesses.
  await markFlagged(ids);

  // 5. Nudge the device to drop its optimistic row (best-effort; the 5s queue
  //    poll is the offline-tolerant baseline if this NOTIFY is missed). Use the
  //    SAME reconciliation key the device stored in posts.submissionId — for an
  //    image batch that's "batch:<batchId>", not the per-row id (sourceRecordIdFor).
  try {
    await notifySubmissionRejected({
      op: "rejected",
      submissionId: sourceRecordIdFor(rows),
      ownerId: anchor.submittedById,
      reason: "flagged",
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    log("warn", "submission-rejected-notify-failed", {
      ids,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  log("warn", "flagged", {
    ids,
    action: error.action,
    severity: error.verdict.severity,
    categories: error.verdict.categories,
    quarantined: quarantinePaths.length,
  });
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
        const submittedById = rows[0]?.submittedById;
        if (submittedById && sourceRecordId) {
          await completeAiGenerationReservationForSource({
            userId: submittedById,
            sourceRecordId,
            resultPostId: existing.id,
          });
        }
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
          sourceRecordId,
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
    // Content-safety flag: terminal, decoupled handling (quarantine + audit +
    // alert + flag + device nudge). NEVER falls through to markFailed (which is
    // retryable) — a flagged row must not reprocess. A SafetyScanError is NOT a
    // SafetyFlagError, so it correctly falls through to the retryable path below
    // (fail-closed: retry the scan, never publish unscanned content).
    if (error instanceof SafetyFlagError) {
      try {
        await handleSafetyFlag(rows, error);
      } catch (flagError) {
        // If the flag handling itself fails, fall back to a plain failure so the
        // row doesn't get stuck in `processing` — but it stays UNpublished.
        const m = flagError instanceof Error ? flagError.message : String(flagError);
        log("error", "flag-handling-failed", { ids, error: m });
        await markFailed(ids, "safety flag handling failed");
      }
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    log("error", "failed", { ids, error: message });
    await markFailed(ids, message);
  }
}

type WorkItem =
  | { type: "ingest"; rows: IngestSubmission[] }
  | { type: "archive"; request: ArchiveRequest }
  | { type: "scene"; userId: string; requestId: string };

async function claimNextWorkItem(): Promise<WorkItem | null> {
  const single = await claimNextNonImage();
  if (single) {
    return { type: "ingest", rows: [single] };
  }
  const batch = await claimReadyImageBatch();
  if (batch.length > 0) {
    return { type: "ingest", rows: batch };
  }
  const archiveReq = await claimNextArchiveRequest();
  if (archiveReq) {
    return { type: "archive", request: archiveReq };
  }
  // Lowest priority: rebuild a stale scene cache (kNN + force layout).
  const sceneReq = await claimNextSceneRecompute();
  if (sceneReq) {
    return { type: "scene", userId: sceneReq.userId, requestId: sceneReq.id };
  }
  return null;
}

async function processWorkItem(item: WorkItem): Promise<void> {
  if (item.type === "ingest") {
    await processBatch(item.rows);
    return;
  }
  if (item.type === "archive") {
    try {
      await processArchiveRequest(item.request, (msg, extra) =>
        log("info", msg, extra),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "archive-failed", { id: item.request.id, error: message });
    }
    return;
  }
  // Scene recompute. Failures self-retry via failSceneRecompute (lease reclaim
  // picks them back up); success deletes the request row.
  try {
    const result = await recomputeOwnerScene(item.userId);
    await completeSceneRecompute(item.requestId);
    log("info", "scene-recompute", {
      userId: item.userId,
      nodes: result.nodes,
      neighbors: result.neighbors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failSceneRecompute(item.requestId, message);
    log("error", "scene-recompute-failed", {
      id: item.requestId,
      error: message,
    });
  }
}

async function fillWorkSlots(
  active: Set<Promise<void>>,
  concurrency: number,
): Promise<boolean> {
  let claimed = false;
  while (!shuttingDown && active.size < concurrency) {
    const item = await claimNextWorkItem();
    if (!item) {
      break;
    }
    claimed = true;
    const job = processWorkItem(item)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "job error", { error: message });
      })
      .finally(() => {
        active.delete(job);
      });
    active.add(job);
  }
  return claimed;
}

async function waitForCapacityOrPoll(
  active: Set<Promise<void>>,
  interval: number,
): Promise<void> {
  if (active.size === 0) {
    await Promise.race([sleep(interval), waitForShutdownSignal()]);
    return;
  }
  await Promise.race([
    sleep(interval),
    Promise.race(active),
    waitForShutdownSignal(),
  ]);
}

async function drainActiveJobs(active: Set<Promise<void>>): Promise<void> {
  if (active.size === 0) {
    return;
  }
  const timeoutMs = shutdownDrainMs();
  let timedOut = false;
  log("info", "draining active jobs", { active: active.size, timeoutMs });
  await Promise.race([
    Promise.allSettled(active),
    sleep(timeoutMs).then(() => {
      timedOut = true;
    }),
  ]);
  if (timedOut) {
    log("warn", "shutdown drain timed out; exiting with active jobs", {
      active: active.size,
    });
    process.exit(0);
  }
}

async function main(): Promise<void> {
  const interval = pollInterval();
  const concurrency = workerConcurrency();
  log("info", "started", {
    pollIntervalMs: interval,
    leaseMs: leaseMs(),
    maxAttempts: maxAttempts(),
    workerConcurrency: concurrency,
    shutdownDrainMs: shutdownDrainMs(),
  });
  process.on("SIGINT", () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));

  // Recover anything a previously-killed worker left stuck in "processing".
  await runReclaim();

  const active = new Set<Promise<void>>();
  while (!shuttingDown) {
    let claimedWork = false;
    try {
      if (active.size === 0) {
        await runReclaim();
      }
      claimedWork = await fillWorkSlots(active, concurrency);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "tick error", { error: message });
    }
    if (shuttingDown) {
      break;
    }
    if (active.size >= concurrency) {
      await Promise.race([Promise.race(active), waitForShutdownSignal()]);
    } else if (!claimedWork) {
      await waitForCapacityOrPoll(active, interval);
    }
  }
  await drainActiveJobs(active);
  log("info", "shutdown complete");
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "fatal", { error: message });
    process.exit(1);
  });
}
