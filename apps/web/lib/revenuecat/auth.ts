// Shared-secret check for the RevenueCat webhook. RevenueCat sends a static
// value in the Authorization header (configured in its dashboard); we
// constant-time compare it against REVENUECAT_WEBHOOK_SECRET so timing leaks
// don't reveal the secret. This is a separate secret from INGEST_TOKEN — the
// webhook is server-to-server with no user session.
import { timingSafeEqual } from "node:crypto";

export type AuthResult = { ok: true } | { ok: false; reason: string };

export function verifyRevenueCatAuth(request: Request): AuthResult {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) {
    return { ok: false, reason: "REVENUECAT_WEBHOOK_SECRET not configured" };
  }
  // RevenueCat puts the raw secret in Authorization (no "Bearer " prefix by
  // default, but tolerate one so the dashboard value can be set either way).
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : header.trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return { ok: false, reason: "invalid secret" };
  }
  return timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: "invalid secret" };
}
