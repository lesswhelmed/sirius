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
