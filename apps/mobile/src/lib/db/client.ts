// The local SQLite handle + Drizzle instance, opened once at module load and
// shared everywhere (Drizzle's useLiveQuery subscribes to expo-sqlite's change
// notifications — no React context needed, but the table must exist before the
// first query, so runMigrations() is awaited in the <DbGate> before first paint).
import { drizzle } from "drizzle-orm/expo-sqlite";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { openDatabaseSync } from "expo-sqlite";

import migrations from "./migrations/migrations";
import * as schema from "./schema";

// enableChangeListener powers useLiveQuery — without it row changes don't
// notify subscribers and the UI won't reactively update.
export const sqlite = openDatabaseSync("sirius.db", {
  enableChangeListener: true,
});

export const db = drizzle(sqlite, { schema });

export type Db = typeof db;

/**
 * Apply pending migrations. Idempotent — Drizzle tracks applied migrations in
 * its own __drizzle_migrations table. Must resolve before any useLiveQuery runs.
 */
export async function runMigrations(): Promise<void> {
  await migrate(db, migrations);
}
