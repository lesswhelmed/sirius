// Pure decision core of the local-store ownership guard (see owner.ts).
// Separated from owner.ts so it carries no expo-sqlite/drizzle imports and can
// be unit-tested under plain `bun test`.

export type LocalStoreDecision = "keep" | "wipe";

/**
 * Given the owner the local mirror was last keyed to (null = never keyed) and
 * the user id of the session that just became active, decide whether the
 * mirror must be wiped before this user's sync loop runs.
 *
 * - Same owner  → keep (normal relaunch keeps its synced data + cursors).
 * - Different owner → wipe (account switch; the previous account's posts,
 *   outbox, vectors, and chats must never be visible to — or replayed as —
 *   the new account).
 * - No stored owner → wipe. A missing owner with a non-empty mirror means the
 *   store predates the guard (or the owner row was lost) and cannot be trusted
 *   to belong to this user; on a genuinely fresh install the wipe is an empty
 *   no-op, so this is always safe.
 */
export function decideOnSignIn(
  storedOwner: string | null,
  sessionUserId: string,
): LocalStoreDecision {
  return storedOwner === sessionUserId ? "keep" : "wipe";
}
