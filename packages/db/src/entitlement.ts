// Freemium metering + RevenueCat entitlement. Two concerns live here:
//
//   1. The weekly cap on SERVER (Gemini) AI generations. Usage is a COUNT(*) of
//      AiGenerationEvent rows in the current week window — no bucket counter to
//      race on. On-device drafts never reach here, so they are never metered.
//   2. The "Sirius AI Pro" entitlement, written by the RevenueCat webhook
//      (applyRevenueCatEvent) and read by the worker (checkProStatus) for the
//      unlimited-generations bypass.
//
// posts.ts stays query-only by contract; this file owns both reads and writes
// for the freemium subsystem (saved.ts/friends.ts are the model to follow).
import { prisma } from "./index";

const DEFAULT_WEEKLY_LIMIT = 10;
const RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;

// The entitlement identifier configured in the RevenueCat dashboard. The webhook
// only reacts to events that grant/revoke THIS entitlement.
export function aiEntitlementId(): string {
  return process.env.REVENUECAT_ENTITLEMENT_ID ?? "Sirius AI Pro";
}

// Free-tier server generations allowed per week. Env-tunable so the cap can move
// without a code deploy.
export function aiWeeklyLimit(): number {
  const raw = process.env.AI_WEEKLY_LIMIT;
  if (!raw) return DEFAULT_WEEKLY_LIMIT;
  const n = Number.parseInt(raw, 10);
  // n >= 0: an explicit 0 is a valid dev/test setting that forces every free
  // capture down the degraded-bookmark (stub) path — used to verify the
  // over-cap UX + Pro regeneration flow without burning real generations.
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_WEEKLY_LIMIT;
}

// Start of the current week: Monday 00:00:00 UTC. The single source of truth for
// the window so the worker (enforcement) and the usage API (display) agree.
export function aiWeekWindowStart(now: Date = new Date()): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

// First instant of the NEXT window (when the free cap resets).
export function aiWeekWindowReset(now: Date = new Date()): Date {
  const start = aiWeekWindowStart(now);
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
}

// Is this user an active "Sirius AI Pro" subscriber? A past expiresAt counts as
// not-Pro even if a cancel/expire webhook never arrived, so a missed event
// self-heals. A null expiresAt with isPro=true is a lifetime/non-expiring grant.
export async function checkProStatus(userId: string): Promise<boolean> {
  const ent = await prisma.userEntitlement.findUnique({
    where: { userId },
    select: { isPro: true, expiresAt: true },
  });
  if (!ent || !ent.isPro) return false;
  if (ent.expiresAt && ent.expiresAt.getTime() < Date.now()) return false;
  return true;
}

// How many server generations the user has consumed in the current week window.
export async function countWeeklyAiGenerations(
  userId: string,
): Promise<number> {
  const now = new Date();
  return prisma.aiGenerationEvent.count({
    where: {
      userId,
      createdAt: { gte: aiWeekWindowStart(now) },
      OR: [
        { status: "completed" },
        { status: "reserved", reservationExpiresAt: { gt: now } },
      ],
    },
  });
}

export type AiGenerationDecision =
  | { allowed: true; isPro: boolean; used: number; limit: number | null }
  | { allowed: false; isPro: false; used: number; limit: number };

// The worker's gate: may this user trigger a SERVER generation right now? Pro
// users are always allowed (and never counted). Free users are allowed until
// they hit the weekly limit.
export async function checkAiGenerationAllowed(
  userId: string,
): Promise<AiGenerationDecision> {
  if (await checkProStatus(userId)) {
    return { allowed: true, isPro: true, used: 0, limit: null };
  }
  const limit = aiWeeklyLimit();
  const used = await countWeeklyAiGenerations(userId);
  if (used < limit) {
    return { allowed: true, isPro: false, used, limit };
  }
  return { allowed: false, isPro: false, used, limit };
}

export type AiGenerationReservation =
  | {
      allowed: true;
      isPro: boolean;
      used: number;
      limit: number | null;
      reservationId: string | null;
    }
  | {
      allowed: false;
      isPro: false;
      used: number;
      limit: number;
      reservationId: null;
    };

// Atomically admits a free-tier server generation. The per-user advisory lock is
// held only for the short count+insert transaction, not during the model call.
// Non-expired reservations count as used; failed jobs delete their reservation.
export async function reserveAiGeneration(input: {
  userId: string;
  kind: string;
  sourceRecordId: string;
}): Promise<AiGenerationReservation> {
  if (await checkProStatus(input.userId)) {
    return {
      allowed: true,
      isPro: true,
      used: 0,
      limit: null,
      reservationId: null,
    };
  }

  const limit = aiWeeklyLimit();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);

  return prisma.$transaction(async (tx) => {
    // $executeRaw (not $queryRaw): pg_advisory_xact_lock returns `void`, which
    // the Prisma pg driver adapter cannot deserialize as a result column.
    // $executeRaw discards the result set and just takes the per-user lock for
    // the duration of this short count+insert transaction.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${"ai-generation:" + input.userId})::bigint)
    `;

    const existing = await tx.aiGenerationEvent.findUnique({
      where: {
        userId_sourceRecordId: {
          userId: input.userId,
          sourceRecordId: input.sourceRecordId,
        },
      },
      select: { id: true, status: true, reservationExpiresAt: true },
    });
    if (
      existing?.status === "reserved" &&
      existing.reservationExpiresAt &&
      existing.reservationExpiresAt > now
    ) {
      await tx.aiGenerationEvent.update({
        where: { id: existing.id },
        data: {
          kind: input.kind,
          reservationExpiresAt: expiresAt,
        },
      });
      return {
        allowed: true,
        isPro: false,
        used: await tx.aiGenerationEvent.count({
          where: {
            userId: input.userId,
            createdAt: { gte: aiWeekWindowStart(now) },
            OR: [
              { status: "completed" },
              { status: "reserved", reservationExpiresAt: { gt: now } },
            ],
          },
        }),
        limit,
        reservationId: existing.id,
      };
    }
    if (existing?.status === "completed") {
      return {
        allowed: true,
        isPro: false,
        used: await tx.aiGenerationEvent.count({
          where: {
            userId: input.userId,
            createdAt: { gte: aiWeekWindowStart(now) },
            OR: [
              { status: "completed" },
              { status: "reserved", reservationExpiresAt: { gt: now } },
            ],
          },
        }),
        limit,
        reservationId: null,
      };
    }

    const used = await tx.aiGenerationEvent.count({
      where: {
        userId: input.userId,
        createdAt: { gte: aiWeekWindowStart(now) },
        OR: [
          { status: "completed" },
          { status: "reserved", reservationExpiresAt: { gt: now } },
        ],
      },
    });

    if (used >= limit) {
      return {
        allowed: false,
        isPro: false,
        used,
        limit,
        reservationId: null,
      };
    }

    const reservation =
      existing?.status === "reserved"
        ? await tx.aiGenerationEvent.update({
            where: { id: existing.id },
            data: {
              kind: input.kind,
              status: "reserved",
              createdAt: now,
              reservationExpiresAt: expiresAt,
            },
            select: { id: true },
          })
        : await tx.aiGenerationEvent.create({
            data: {
              userId: input.userId,
              kind: input.kind,
              sourceRecordId: input.sourceRecordId,
              status: "reserved",
              reservationExpiresAt: expiresAt,
            },
            select: { id: true },
          });

    return {
      allowed: true,
      isPro: false,
      used,
      limit,
      reservationId: reservation.id,
    };
  });
}

export async function completeAiGenerationReservation(input: {
  reservationId: string;
  resultPostId?: string | null;
}): Promise<void> {
  await prisma.aiGenerationEvent.updateMany({
    where: { id: input.reservationId, status: "reserved" },
    data: {
      status: "completed",
      resultPostId: input.resultPostId ?? null,
      reservationExpiresAt: null,
    },
  });
}

export async function completeAiGenerationReservationForSource(input: {
  userId: string;
  sourceRecordId: string;
  resultPostId?: string | null;
}): Promise<void> {
  await prisma.aiGenerationEvent.updateMany({
    where: {
      userId: input.userId,
      sourceRecordId: input.sourceRecordId,
      status: "reserved",
    },
    data: {
      status: "completed",
      resultPostId: input.resultPostId ?? null,
      reservationExpiresAt: null,
    },
  });
}

export async function cancelAiGenerationReservation(
  reservationId: string,
): Promise<void> {
  await prisma.aiGenerationEvent.deleteMany({
    where: { id: reservationId, status: "reserved" },
  });
}

// Record that a server generation actually happened. Call AFTER runGemini
// succeeds so a model failure never burns quota.
export async function recordAiGeneration(input: {
  userId: string;
  kind: string;
  resultPostId?: string | null;
}): Promise<void> {
  await prisma.aiGenerationEvent.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      resultPostId: input.resultPostId ?? null,
    },
  });
}

export type AiUsage = {
  used: number;
  limit: number | null; // null = unlimited (Pro)
  remaining: number | null; // null = unlimited
  isPro: boolean;
  resetsAt: string | null; // ISO; null for Pro
};

// The client-facing view of a user's weekly budget (GET /api/app/usage).
export async function getAiUsage(userId: string): Promise<AiUsage> {
  const isPro = await checkProStatus(userId);
  const used = await countWeeklyAiGenerations(userId);
  if (isPro) {
    return { used, limit: null, remaining: null, isPro: true, resetsAt: null };
  }
  const limit = aiWeeklyLimit();
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    isPro: false,
    resetsAt: aiWeekWindowReset().toISOString(),
  };
}

// Manually grant/revoke "Sirius AI Pro" for a user, bypassing RevenueCat — for
// comps, the team, support overrides, etc. (see scripts/grant-pro.ts). A grant
// with expiresAt=null is effectively lifetime. store is marked MANUAL_GRANT so
// it's distinguishable from a real purchase; a later RevenueCat event for the
// same user still applies normally (no lastEventAt is set here).
export async function setProEntitlement(input: {
  userId: string;
  isPro: boolean;
  expiresAt?: Date | null;
}): Promise<void> {
  const expiresAt = input.expiresAt ?? null;
  await prisma.userEntitlement.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      isPro: input.isPro,
      entitlementId: aiEntitlementId(),
      store: "MANUAL_GRANT",
      expiresAt,
    },
    update: {
      isPro: input.isPro,
      entitlementId: aiEntitlementId(),
      store: "MANUAL_GRANT",
      expiresAt,
    },
  });
}

// ─── RevenueCat webhook ──────────────────────────────────────────────────────

// The subset of a RevenueCat webhook event we act on. The route maps the raw
// payload (event.app_user_id, event.entitlement_ids, …) into this shape.
export type RevenueCatEvent = {
  id: string;
  type: string;
  appUserId: string; // must equal our User.id (mobile calls Purchases.logIn(userId))
  entitlementIds: string[];
  productId: string | null;
  store: string | null;
  expirationAtMs: number | null;
  eventTimestampMs: number;
  rcCustomerId?: string | null;
};

// Event types that GRANT the entitlement (turn Pro on). NON_RENEWING_PURCHASE
// covers Lifetime (no expiry). TRANSFER-in is treated as a grant for the
// resolved user (the route sets appUserId to the receiving id).
const ACTIVATE_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "TRANSFER",
]);
// Event types that REVOKE access immediately.
const DEACTIVATE_TYPES = new Set(["EXPIRATION"]);
// CANCELLATION / BILLING_ISSUE / SUBSCRIPTION_PAUSED do NOT flip isPro off — the
// user keeps access until expiresAt, which checkProStatus enforces.

export type ApplyEventResult = {
  applied: boolean;
  reason?: "stale" | "duplicate" | "unknown-user" | "other-entitlement";
};

// Idempotent, order-safe upsert of a user's entitlement from one webhook event.
// Returns applied:false (with a reason) for events we intentionally ignore so
// the route can still 200 them (RevenueCat retries on non-2xx).
export async function applyRevenueCatEvent(
  event: RevenueCatEvent,
): Promise<ApplyEventResult> {
  // Only react to the "Sirius AI Pro" entitlement. EXPIRATION events still carry
  // the entitlement id, so revocation is scoped the same way.
  if (!event.entitlementIds.includes(aiEntitlementId())) {
    return { applied: false, reason: "other-entitlement" };
  }

  const user = await prisma.user.findUnique({
    where: { id: event.appUserId },
    select: { id: true },
  });
  if (!user) return { applied: false, reason: "unknown-user" };

  const existing = await prisma.userEntitlement.findUnique({
    where: { userId: user.id },
    select: { isPro: true, lastEventId: true, lastEventAt: true },
  });

  // Replay / out-of-order guards.
  if (existing?.lastEventId === event.id) {
    return { applied: false, reason: "duplicate" };
  }
  if (
    existing?.lastEventAt &&
    existing.lastEventAt.getTime() > event.eventTimestampMs
  ) {
    return { applied: false, reason: "stale" };
  }

  const isPro = ACTIVATE_TYPES.has(event.type)
    ? true
    : DEACTIVATE_TYPES.has(event.type)
      ? false
      : (existing?.isPro ?? false); // CANCELLATION/BILLING_ISSUE: leave as-is

  const expiresAt =
    event.expirationAtMs != null ? new Date(event.expirationAtMs) : null;
  const lastEventAt = new Date(event.eventTimestampMs);

  await prisma.userEntitlement.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      isPro,
      rcAppUserId: event.appUserId,
      rcCustomerId: event.rcCustomerId ?? null,
      entitlementId: aiEntitlementId(),
      productId: event.productId,
      store: event.store,
      expiresAt,
      lastEventId: event.id,
      lastEventAt,
    },
    update: {
      isPro,
      rcAppUserId: event.appUserId,
      rcCustomerId: event.rcCustomerId ?? undefined,
      entitlementId: aiEntitlementId(),
      productId: event.productId ?? undefined,
      store: event.store ?? undefined,
      expiresAt,
      lastEventId: event.id,
      lastEventAt,
    },
  });

  return { applied: true };
}
