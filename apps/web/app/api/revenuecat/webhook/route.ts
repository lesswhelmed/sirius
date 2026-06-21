import { applyRevenueCatEvent, type RevenueCatEvent } from "@repo/db";
import { verifyRevenueCatAuth } from "../../../../lib/revenuecat/auth";

// RevenueCat → server webhook. Server-to-server (NOT session-authed): RevenueCat
// is the source of truth for the "Sirius AI Pro" entitlement, and this is how it
// reaches Postgres so the worker can read the Pro bypass. Auth is a shared secret
// in the Authorization header. We map RevenueCat's payload into RevenueCatEvent
// and delegate the (idempotent, order-safe, entitlement-scoped) upsert to the db
// layer. We return 200 for everything we successfully process OR intentionally
// ignore (unknown user, duplicate, other entitlement) so RevenueCat stops
// retrying; only auth/parse failures are non-2xx.

type RawEvent = {
  id?: unknown;
  type?: unknown;
  app_user_id?: unknown;
  original_app_user_id?: unknown;
  product_id?: unknown;
  entitlement_ids?: unknown;
  entitlement_id?: unknown;
  store?: unknown;
  expiration_at_ms?: unknown;
  event_timestamp_ms?: unknown;
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mapEvent(raw: RawEvent): RevenueCatEvent | null {
  const id = asString(raw.id);
  const type = asString(raw.type);
  const appUserId = asString(raw.app_user_id);
  if (!id || !type || !appUserId) return null;

  const entitlementIds = Array.isArray(raw.entitlement_ids)
    ? raw.entitlement_ids.filter((x): x is string => typeof x === "string")
    : asString(raw.entitlement_id)
      ? [raw.entitlement_id as string]
      : [];

  return {
    id,
    type,
    appUserId,
    entitlementIds,
    productId: asString(raw.product_id),
    store: asString(raw.store),
    expirationAtMs: asNumber(raw.expiration_at_ms),
    eventTimestampMs: asNumber(raw.event_timestamp_ms) ?? Date.now(),
    rcCustomerId: asString(raw.original_app_user_id),
  };
}

export async function POST(request: Request) {
  const auth = verifyRevenueCatAuth(request);
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const rawEvent = (body as { event?: RawEvent } | null)?.event;
  if (!rawEvent || typeof rawEvent !== "object") {
    return Response.json({ error: "missing event" }, { status: 400 });
  }

  const event = mapEvent(rawEvent);
  if (!event) {
    return Response.json({ error: "malformed event" }, { status: 400 });
  }

  const result = await applyRevenueCatEvent(event);
  // 200 for both applied and intentionally-ignored so RevenueCat stops retrying.
  return Response.json(result, { status: 200 });
}
