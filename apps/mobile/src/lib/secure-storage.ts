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
// The migration below is deliberately FORMAT-AGNOSTIC: it never parses the
// plugin's private storage format (chunk markers, counts, encoding). Anything
// it misses self-heals, because reads never throw — a missed item is just a
// cache miss, the plugin refetches the session from the server and rewrites
// through the wrapper, which always applies AFTER_FIRST_UNLOCK on fresh keys.
// The only (weak, failure-benign) assumption is the `<key>.<i>` suffix the
// plugin uses for chunked payloads, probed blindly below.
const AUTH_STORAGE_KEYS = ["siriusapp_cookie", "siriusapp_session_data"];

// Sentinel: once every key has been rewritten without error, this is set and
// every later launch skips the whole scan with a single keychain read. Bump
// the value to force a re-migration.
const MIGRATION_SENTINEL_KEY = "siriusapp_keychain_migration";
const MIGRATION_SENTINEL_VALUE = "2";

// Runaway bound for the blind chunk probe — far above any realistic chunk
// count (chunks exist to dodge the ~4KB keychain item ceiling).
const MAX_CHUNK_PROBE = 64;

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

// One-time re-write of existing auth items — created under the old
// WHEN_UNLOCKED default — to AFTER_FIRST_UNLOCK. Idempotent, never throws.
//
// Format-agnostic by design (see AUTH_STORAGE_KEYS header): instead of parsing
// the plugin's chunk marker, we blindly probe `<key>.0`, `<key>.1`, … until the
// first missing item (capped at MAX_CHUNK_PROBE) and rewrite whatever exists,
// then rewrite the base key (chunks before base, so a crash mid-migration
// leaves the base — the entry point readers see — pointing at already-migrated
// chunks). A non-chunked value costs one extra null read per key. If every key
// migrated without error we persist the sentinel so later launches pay a
// single keychain read; any error skips the sentinel and retries next launch.
export async function migrateAuthStorageAccessibility(): Promise<void> {
  if (migrationStarted) return;
  migrationStarted = true;
  const sentinel = authSecureStorage.getItem(MIGRATION_SENTINEL_KEY);
  if (sentinel === MIGRATION_SENTINEL_VALUE) return;
  let hadError = false;
  for (const key of AUTH_STORAGE_KEYS) {
    try {
      for (let i = 0; i < MAX_CHUNK_PROBE; i++) {
        const chunkKey = `${key}.${i}`;
        const chunk = await SecureStore.getItemAsync(chunkKey);
        if (chunk == null) break;
        await rewriteWithAccessibility(chunkKey, chunk);
      }
      const value = await SecureStore.getItemAsync(key);
      if (value != null) {
        await rewriteWithAccessibility(key, value);
      }
    } catch (error) {
      hadError = true;
      warnOnce("migrate", key, error);
    }
  }
  if (!hadError) {
    authSecureStorage.setItem(MIGRATION_SENTINEL_KEY, MIGRATION_SENTINEL_VALUE);
  }
}
