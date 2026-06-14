// Web-only stand-in for `expo-sqlite`.
//
// The offline-first local store (`@/lib/db/client` + drizzle's `useLiveQuery`)
// is a NATIVE, on-device concern — phase-1 text-only SQLite on the phone. Web
// is not a product surface here (`app.json` → `web.output: "static"`, so it's
// rendered in Node at build time, where expo-sqlite's real OPFS/Web-Worker VFS
// can't run anyway). Yet the web bundle still pulls `expo-sqlite` into its graph
// two ways:
//   1. `@/lib/db/client` → `import { openDatabaseSync } from "expo-sqlite"`
//   2. `drizzle-orm/expo-sqlite` (useLiveQuery) →
//        `import { addDatabaseChangeListener } from "expo-sqlite"`
// expo-sqlite's web entry (web/worker.ts) `import`s `./wa-sqlite/wa-sqlite.wasm`,
// which Metro can't resolve (`.wasm` isn't in this project's resolver extensions)
// — so the web bundle fails even though iOS/Android are fine.
//
// metro.config.js redirects the bare `expo-sqlite` module to this file ONLY when
// `platform === "web"`, so the native bundle imports the real package unchanged
// and only web gets this inert no-op. We implement just the two named exports the
// web graph actually touches at runtime; both no-op so a stray render degrades
// quietly instead of crashing the bundler.

import type { SQLiteDatabase } from "expo-sqlite";

// drizzle()'s constructor only stores the client; query methods (prepareSync,
// runSync, …) are lazy and never fire during static web render. We expose them
// as throwing/no-op shims so any accidental web query fails loudly with a clear
// message rather than a cryptic "undefined is not a function".
const notAvailable = (): never => {
  throw new Error(
    "[db] The on-device SQLite store is native-only; it is not available on web."
  );
};

export function openDatabaseSync(): SQLiteDatabase {
  return new Proxy(
    {},
    {
      get: () => notAvailable,
    }
  ) as unknown as SQLiteDatabase;
}

// useLiveQuery subscribes to change notifications via this; on web there is no
// database, so return an inert subscription whose remove() is a no-op.
export function addDatabaseChangeListener(): { remove: () => void } {
  return { remove: () => {} };
}
