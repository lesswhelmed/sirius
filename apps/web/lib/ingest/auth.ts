// Bearer-token check for the ingest endpoints. Constant-time compare against
// INGEST_TOKEN so timing leaks don't reveal token shape.
import { createHash, timingSafeEqual } from "node:crypto";

import { rateLimit } from "../rate-limit";

const BEARER_PREFIX = "Bearer ";

export type AuthResult = { ok: true } | { ok: false; reason: string };

function getExpectedToken(): string | undefined {
  return process.env.INGEST_TOKEN;
}

export function verifyBearer(request: Request): AuthResult {
  const expected = getExpectedToken();
  if (!expected) {
    return { ok: false, reason: "INGEST_TOKEN not configured" };
  }
  const header = request.headers.get("authorization");
  if (!header?.startsWith(BEARER_PREFIX)) {
    return { ok: false, reason: "missing bearer token" };
  }
  const provided = header.slice(BEARER_PREFIX.length).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return { ok: false, reason: "invalid token" };
  }
  return timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: "invalid token" };
}

// --- Bearer ingest rate limiting -------------------------------------------
// A leaked INGEST_TOKEN would otherwise mean unlimited AI spend / flood: the
// bearer routes have no per-user quota (there is no user to attribute). This is
// the web-edge throttle layer (the worker enforces a second AI-generation cap).
// It reuses the process-local fixed-window `rateLimit` primitive — abuse damping
// for a single PM2 fork, not a billing-grade quota. Always on (dev can curl to
// verify); it is not gated on production.

// Fixed 1-minute windows for the edge throttle.
const RATE_WINDOW_MS = 60_000;
const DEFAULT_PER_MAX = 60;
const DEFAULT_GLOBAL_MAX = 600;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// First XFF hop (Caddy sets it), then x-real-ip, then a shared "unknown"
// bucket so callers behind a proxy that strips both still get a global-ish cap.
function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) {
    return real;
  }
  return "unknown";
}

// De-identified token key: sha256(token) truncated. The raw token is NEVER
// logged or used as a map key.
function tokenFingerprint(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith(BEARER_PREFIX)
    ? header.slice(BEARER_PREFIX.length).trim()
    : "";
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export type BearerRateLimitResult =
  | { ok: true }
  | { ok: false; status: 429; retryAfterMs: number; scope: string };

// Two-phase throttle:
//   phase "pre"  — pre-auth IP-only guard (`ingest:ip:${ip}`), so an attacker
//                  can't burn CPU probing tokens without also hitting a ceiling.
//   phase "post" — per-caller (`ingest:${fp}:${ip}`) + global (`ingest:global`)
//                  windows, called AFTER verifyBearer confirms a valid token.
export function enforceBearerRateLimit(
  request: Request,
  phase: "pre" | "post" = "post",
): BearerRateLimitResult {
  const ip = clientIp(request);
  const perMax = envInt("INGEST_RL_PER_MAX", DEFAULT_PER_MAX);

  if (phase === "pre") {
    const guard = rateLimit(`ingest:ip:${ip}`, perMax, RATE_WINDOW_MS);
    if (!guard.ok) {
      return {
        ok: false,
        status: 429,
        retryAfterMs: guard.retryAfterMs,
        scope: "ip",
      };
    }
    return { ok: true };
  }

  const fp = tokenFingerprint(request);
  const perCaller = rateLimit(`ingest:${fp}:${ip}`, perMax, RATE_WINDOW_MS);
  if (!perCaller.ok) {
    return {
      ok: false,
      status: 429,
      retryAfterMs: perCaller.retryAfterMs,
      scope: "caller",
    };
  }

  const globalMax = envInt("INGEST_RL_GLOBAL_MAX", DEFAULT_GLOBAL_MAX);
  const global = rateLimit("ingest:global", globalMax, RATE_WINDOW_MS);
  if (!global.ok) {
    return {
      ok: false,
      status: 429,
      retryAfterMs: global.retryAfterMs,
      scope: "global",
    };
  }

  return { ok: true };
}
