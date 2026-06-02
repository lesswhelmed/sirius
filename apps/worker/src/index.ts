// Long-running daemon: poll the IngestSubmission table, claim a row (or a full
// image batch once totalCount rows are present), run the pipeline, mark the
// row(s) completed or failed. Run with `bun run start` (see README).
import { setTimeout as sleep } from "node:timers/promises";
import {
  claimNextNonImage,
  claimReadyImageBatch,
  findPostBySourceRecordId,
  heartbeatProcessing,
  type IngestSubmission,
  markCompleted,
  markFailed,
  reclaimStaleProcessing,
} from "@repo/db";
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
  extra?: Record<string, unknown>
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

// Resurrect rows stranded in "processing" by a hard-killed worker. Best-effort:
// a DB hiccup here must not crash the daemon.
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "reclaim error", { error: message });
  }
}

type PayloadShape = {
  urls?: unknown;
  notes?: unknown;
  force?: unknown;
};

function readPayload(submission: IngestSubmission): PayloadShape {
  const p = submission.payload;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return p as PayloadShape;
  }
  return {};
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
    const notes = (readPayload(first).notes as string | undefined) ?? "";
    return {
      kind: "image",
      submissions: rows,
      batchId: first.batchId,
      notes,
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
          (u): u is string => typeof u === "string"
        )
      : [];
    const force = payload.force === true;
    return {
      kind: "url",
      submission: first,
      urls,
      notes,
      force,
      submittedById,
      projectId,
    };
  }
  return {
    kind: "note",
    submission: first,
    notes,
    submittedById,
    projectId,
  };
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
        await markCompleted(ids, { resultPostSlug: existing.slug });
        for (const row of rows) {
          removeStagedFile(row.stagedFilePath);
        }
        log("info", "idempotent-skip", { ids, slug: existing.slug });
        return;
      }
    }
    const input = buildInput(rows);
    const stageLogger = (stage: string, extra?: Record<string, unknown>) =>
      log("info", `stage:${stage}`, { ids, ...(extra ?? {}) });
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
      });
      for (const row of rows) {
        removeStagedFile(row.stagedFilePath);
      }
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
