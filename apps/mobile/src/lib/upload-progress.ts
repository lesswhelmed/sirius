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
