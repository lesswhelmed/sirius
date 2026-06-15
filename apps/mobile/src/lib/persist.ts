// Tiny string-set persistence keyed per user, backed by expo-secure-store
// (already a dependency — see auth-client.ts). Used by the Tree tab to remember
// which outline branches are expanded across tab switches AND app relaunch.
//
// SecureStore keys are restricted to [A-Za-z0-9._-]; the Tree's expanded
// "paths" are category path strings (contain "/"), so we never key BY a path —
// we serialize the whole Set into ONE value under a per-user, slug-safe key.
import * as SecureStore from "expo-secure-store";

// SecureStore values cap at ~2KB. The taxonomy is small (a few dozen branches),
// so the serialized expanded set is well under that, but guard anyway: if a set
// ever overflows we drop the persist rather than throw.
const MAX_VALUE_BYTES = 2000;

// Slugify an arbitrary id (e.g. a user id) into the SecureStore key charset.
function safeKey(prefix: string, id: string): string {
  return `${prefix}.${id.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export async function loadStringSet(
  prefix: string,
  id: string
): Promise<Set<string>> {
  try {
    const raw = await SecureStore.getItemAsync(safeKey(prefix, id));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // Corrupt/unreadable value — start fresh rather than wedge the screen.
    return new Set();
  }
}

export async function saveStringSet(
  prefix: string,
  id: string,
  value: Set<string>
): Promise<void> {
  try {
    const json = JSON.stringify([...value]);
    if (json.length > MAX_VALUE_BYTES) return; // too big to persist; skip
    await SecureStore.setItemAsync(safeKey(prefix, id), json);
  } catch {
    // Persistence is best-effort; a write failure must never break the UI.
  }
}
