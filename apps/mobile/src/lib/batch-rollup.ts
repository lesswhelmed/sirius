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
  // Spec §4.7: "all sent/pending -> Received" (every slot), else if any slot is
  // being drafted by the server -> Drafting. Received must be ALL, so a single
  // drafting slot advances the whole batch to Drafting.
  if (
    slots.length > 0 &&
    slots.every((s) => s.status === "received" || s.status === "queued")
  ) {
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
