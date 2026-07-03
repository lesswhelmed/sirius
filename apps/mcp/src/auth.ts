// Bearer-key verification for the MCP corpus service. Each HTTP request carries
// `Authorization: Bearer <user-api-key>`; we verify it against the better-auth
// apiKey() plugin (added to @repo/auth) WITHOUT an HTTP round-trip — calling
// `auth.api.verifyApiKey` directly off the imported instance. On success the
// owning userId is `result.key.referenceId` (the apiKey plugin's owner FK is
// `referenceId`, NOT `userId`). Rate-limit / expiry / enabled checks are all
// enforced inside verifyApiKey, so a throttled or expired key resolves to null.
import { auth } from "@repo/auth";
import { prisma } from "@repo/db";

function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return null;
  }
  const key = match[1]?.trim();
  return key && key.length > 0 ? key : null;
}

// Verify the request's Bearer key and resolve the owning user. Returns null for
// any failure (missing/malformed header, invalid/expired/revoked/rate-limited
// key, or an upstream error) — the caller maps null to HTTP 401 and never
// reveals whether a given key exists.
export async function verifyKey(
  request: Request,
): Promise<{ userId: string } | null> {
  const key = extractBearer(request);
  if (!key) {
    return null;
  }
  try {
    const result = await auth.api.verifyApiKey({ body: { key } });
    if (!result.valid || !result.key) {
      return null;
    }
    const userId = result.key.referenceId;
    if (!userId) {
      return null;
    }
    // verifyApiKey validates the key (existence/expiry/enabled/rate-limit) but
    // NOT the owning user's moderation status. A banned user's key would still
    // resolve, so reject if the owner is banned — moderation revokes keys on
    // ban (scripts/moderation/resolve-report.ts), but this is the defense-in-
    // depth gate for any key minted/left behind out of band.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { banned: true },
    });
    if (!user || user.banned) {
      return null;
    }
    return { userId };
  } catch {
    // Treat any verification error as "unauthorized" — never leak details.
    return null;
  }
}
