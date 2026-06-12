// Minimal in-memory fixed-window rate limiter for custom API routes
// (better-auth's DB-backed limiter only covers /api/auth/*). Sound for this
// deployment: production runs a single PM2 fork process, so one process sees
// all traffic. Caveat: counters reset on restart/redeploy — acceptable for
// abuse damping, not billing-grade quotas.
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

// Sweep expired windows occasionally so the map can't grow unbounded.
let lastSweep = 0;
function sweep(now: number): void {
  if (now - lastSweep < 60_000) {
    return;
  }
  lastSweep = now;
  for (const [key, win] of windows) {
    if (win.resetAt <= now) {
      windows.delete(key);
    }
  }
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

// Counts a hit against `key`'s fixed window; rejects once `max` is exceeded.
// Keys are held in memory only and never logged or persisted by callers that
// promise de-identification (e.g. the extract endpoint keys by user id solely
// to scope abuse, without recording who asked for what).
export function rateLimit(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const win = windows.get(key);
  if (!win || win.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  win.count += 1;
  if (win.count > max) {
    return { ok: false, retryAfterMs: win.resetAt - now };
  }
  return { ok: true };
}
