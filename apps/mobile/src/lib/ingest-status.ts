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
