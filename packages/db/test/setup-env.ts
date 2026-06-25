// Test preload for the DB integration suite.
//
// bun only auto-loads `.env` from the current working directory, but the db
// test suites run from `packages/db` where there is no `.env` — the real one
// lives at the repo root. So we load it explicitly here, then point Prisma at
// the test database BEFORE any module imports `../src/index` and constructs the
// client (the client reads DATABASE_URL at construction time).
//
// Use via: `bun test --preload ./test/setup-env.ts ...`
// With no TEST_DATABASE_URL set, DATABASE_URL is left untouched and the
// integration suite's RUN_DB gate skips it — so this never redirects a normal run.
import { join } from "node:path";

import { config } from "dotenv";

config({ path: join(import.meta.dir, "../../../.env") });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
