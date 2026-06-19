// Shared docroot resolution for worker-written media. Both the post-writer
// (SIGHT galleries + localized covers) and the image-generator (auto-generated
// covers) write into apps/web/public so Next.js / Caddy can serve them. Kept in
// its own module so image-generator.ts can reuse resolveSocialDir/ensureDir
// without importing post-writer.ts (which imports image-generator → would cycle).

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Default lands MDX-served image batches in apps/web/public/sight/<batchId>/
// when the worker is run from apps/worker/. Operators can override via
// SIGHT_IMAGE_DIR (must be an absolute path so PM2 / Docker / systemd can
// target a different docroot without changing cwd assumptions).
export function resolveSightDir(): string {
  const override = process.env.SIGHT_IMAGE_DIR?.trim();
  if (override) {
    return override;
  }
  return resolve(process.cwd(), "..", "web", "public", "sight");
}

// Cover images for URL/social ingests (e.g. Instagram) and auto-generated
// covers live in apps/web/public/social/ so they're served from our own origin.
// This is essential for Instagram: its CDN URLs are signed and expire within
// days, so we must download the bytes once at ingestion rather than hot-link them.
export function resolveSocialDir(): string {
  const override = process.env.SOCIAL_IMAGE_DIR?.trim();
  if (override) {
    return override;
  }
  return resolve(process.cwd(), "..", "web", "public", "social");
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
