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
