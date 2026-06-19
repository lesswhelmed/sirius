import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Monorepo: .env lives at the repo root. Load it explicitly so that calling
// `prisma generate` / `prisma migrate` from packages/db works regardless of
// whether the operator sourced .env into their shell.
loadDotenv({ path: resolve(__dirname, "..", "..", ".env"), quiet: true });

export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: {
		path: "prisma/migrations",
	},
	datasource: {
		url: env("DATABASE_URL"),
	},
});
