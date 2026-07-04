// Layer 2 of the bearer-ingest hardening (the web edge throttle is layer 1).
//
// Bearer-path ingests (iOS Shortcut / scripts authenticating with INGEST_TOKEN)
// are UNATTRIBUTED — submittedById is null, so there is no user quota to charge.
// Before this cap they got unmetered Gemini generations, meaning a leaked
// INGEST_TOKEN was unlimited AI spend even if the web edge throttle were bypassed
// (e.g. traffic that never traversed Caddy). This bounds bearer AI generations to
// a fixed window.
//
// Process-local in-memory fixed-window counter: sound because production runs a
// single sirius-worker fork. Counter resets on restart — abuse/spend damping, not
// a billing-grade quota. Consulting it is the ONLY thing that decides whether a
// bearer submission drafts via Gemini; over the cap the worker falls back to a
// DRAFT stub (the ingest still lands, nothing crashes).

const DEFAULT_WINDOW_MAX = 200;
const DEFAULT_WINDOW_MS = 86_400_000; // 24h

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

type Window = { count: number; resetAt: number };

let current: Window | null = null;

export type BearerMeterResult =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; used: number; limit: number; retryAfterMs: number };

// Counts one bearer AI generation against the active window. Returns allowed:false
// once the window is saturated (without incrementing further). `now` is injectable
// for tests; production always uses Date.now().
export function consumeBearerAiGeneration(now: number = Date.now()): BearerMeterResult {
  const limit = envInt("BEARER_AI_WINDOW_MAX", DEFAULT_WINDOW_MAX);
  const windowMs = envInt("BEARER_AI_WINDOW_MS", DEFAULT_WINDOW_MS);

  if (!current || current.resetAt <= now) {
    current = { count: 1, resetAt: now + windowMs };
    return { allowed: true, used: 1, limit };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      used: current.count,
      limit,
      retryAfterMs: current.resetAt - now,
    };
  }

  current.count += 1;
  return { allowed: true, used: current.count, limit };
}

// Test-only: drop the active window so a suite starts from a clean count.
export function resetBearerMeter(): void {
  current = null;
}
