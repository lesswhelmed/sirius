// The SINGLE source of truth for user-handle validation. A handle is the public
// URL slug for a user's catalog page (/catalog/<handle>, /u/<handle>), so it must
// be lowercase + URL-safe AND may not impersonate an official surface or collide
// with an app route word.
//
// Pure module: no DB, no env reads, no I/O. Callers (packages/db/src/users.ts)
// run this first, then do the uniqueness check against Postgres.

// URL-safe slug shape: starts alphanumeric, then 2-29 more of [a-z0-9-], so the
// full handle is 3-30 chars. Single source of truth for the shape — findUserByHandle
// (read path, legacy holders must still resolve) and setUserHandle both use it.
export const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{2,29}$/;

// Handles a user may NOT claim: brand/authority words that would make an account
// look official, plus app route words that appear under /u or /catalog (avoids
// public-URL collisions). All lowercase — validateHandle lowercases before lookup.
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  // brand / authority
  "admin",
  "administrator",
  "support",
  "help",
  "sirius",
  "security",
  "api",
  "root",
  "mod",
  "moderator",
  "staff",
  "official",
  "team",
  "billing",
  "contact",
  "abuse",
  "legal",
  "privacy",
  "terms",
  "about",
  // app route words (public-URL collision guard)
  "settings",
  "login",
  "signin",
  "signup",
  "logout",
  "feed",
  "friends",
  "space",
  "catalog",
  "explore",
  "queue",
  "composer",
  "library",
  "tree",
  "u",
  "me",
  // reserved sentinels
  "null",
  "undefined",
]);

export type ValidateHandleResult =
  | { ok: true; handle: string }
  | { ok: false; reason: "invalid" | "reserved" };

// Pure handle validation. Normalizes (trim + lowercase), checks the URL-safe
// shape ("invalid"), then the reserved list ("reserved"), else returns the
// normalized handle. Order matters: an ill-shaped handle is "invalid" even if it
// would also be reserved.
export function validateHandle(raw: string): ValidateHandleResult {
  const lower = raw.trim().toLowerCase();
  if (!HANDLE_REGEX.test(lower)) {
    return { ok: false, reason: "invalid" };
  }
  if (RESERVED_HANDLES.has(lower)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, handle: lower };
}
