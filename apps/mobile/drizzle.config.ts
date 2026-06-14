import type { Config } from "drizzle-kit";

// drizzle-kit generates SQL migrations from schema.ts into src/lib/db/migrations.
// `driver: "expo"` makes it also emit the bundled `migrations.js` that the
// expo-sqlite migrator consumes (the raw .sql files are inlined by
// babel-plugin-inline-import at build time — see babel.config.js).
export default {
  dialect: "sqlite",
  driver: "expo",
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
} satisfies Config;
