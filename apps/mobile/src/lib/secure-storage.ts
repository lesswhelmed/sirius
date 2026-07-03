// Keychain storage for the better-auth expo client. Invariant: auth items MUST
// be AFTER_FIRST_UNLOCK and reads MUST never throw — the auth client is built at
// import time, and locked-device launches (background outbox task, prewarm, Siri
// capture) hit errSecInteractionNotAllowed on WHEN_UNLOCKED items → import-time
// fatal. A failed read degrades to "no session" instead.
import * as SecureStore from "expo-secure-store";

// AFTER_FIRST_UNLOCK (not THIS_DEVICE_ONLY) keeps backup/restore semantics
// identical to the old WHEN_UNLOCKED default — only lock-state readability
// changes.
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

// Keys the @better-auth/expo plugin writes with `storagePrefix: "siriusapp"`.
// Oversized values are chunked: the base key holds `<CHUNK_MARKER><count>` and
// the payload lives in `<key>.0..count-1`. Marker/parse mirror the plugin
// (@better-auth/expo dist/client.js), including its leading \u0001 byte.
const AUTH_STORAGE_KEYS = ["siriusapp_cookie", "siriusapp_session_data"];
const CHUNK_MARKER = "\u0001ba-chunks:";

const warned = new Set<string>();
function warnOnce(op: string, key: string, error: unknown): void {
  const id = `${op}:${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[secure-storage] ${op} "${key}" failed`, error);
}

// Satisfies the plugin's storage interface (sync getItem/setItem only — it
// calls no remove). Errors are swallowed by contract; see header.
export const authSecureStorage = {
  getItem(key: string): string | null {
    try {
      return SecureStore.getItem(key, KEYCHAIN_OPTIONS);
    } catch (error) {
      warnOnce("get", key, error);
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      SecureStore.setItem(key, value, KEYCHAIN_OPTIONS);
    } catch (error) {
      warnOnce("set", key, error);
    }
  },
};

// iOS applies kSecAttrAccessible only on the SecItemAdd path; the duplicate-item
// SecItemUpdate path sends kSecValueData alone (SecureStoreModule.swift), so a
// plain re-set of an existing item keeps its old WHEN_UNLOCKED accessibility.
// Delete first to force the add path.
async function rewriteWithAccessibility(
  key: string,
  value: string,
): Promise<void> {
  await SecureStore.deleteItemAsync(key);
  await SecureStore.setItemAsync(key, value, KEYCHAIN_OPTIONS);
}

let migrationStarted = false;

// One-time (per JS session) re-write of existing auth items — created under the
// old WHEN_UNLOCKED default — to AFTER_FIRST_UNLOCK. Idempotent, never throws.
export async function migrateAuthStorageAccessibility(): Promise<void> {
  if (migrationStarted) return;
  migrationStarted = true;
  for (const key of AUTH_STORAGE_KEYS) {
    try {
      const value = await SecureStore.getItemAsync(key);
      if (value == null) continue;
      if (value.startsWith(CHUNK_MARKER)) {
        const count = Number(value.slice(CHUNK_MARKER.length));
        if (Number.isInteger(count) && count >= 1) {
          for (let i = 0; i < count; i++) {
            const chunkKey = `${key}.${i}`;
            const chunk = await SecureStore.getItemAsync(chunkKey);
            if (chunk == null) continue;
            await rewriteWithAccessibility(chunkKey, chunk);
          }
        }
      }
      await rewriteWithAccessibility(key, value);
    } catch (error) {
      warnOnce("migrate", key, error);
    }
  }
}
