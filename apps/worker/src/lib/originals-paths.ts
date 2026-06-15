// Docroot resolution for PRIVATE retained originals + built archives. Unlike
// media-paths.ts (which writes into apps/web/public so Caddy/Next can serve the
// files), these roots live OUTSIDE public/ and are never fronted by Caddy — the
// only access is through the owner-/token-gated Next route handlers. Defaults
// resolve to <repo>/private-uploads/{originals,archives} when the worker runs
// from apps/worker/. Override with ORIGINALS_DIR / ARCHIVES_DIR (absolute paths).
import { resolve } from "node:path";

export { ensureDir } from "./media-paths";

export function resolveOriginalsDir(): string {
  const override = process.env.ORIGINALS_DIR?.trim();
  if (override) {
    return override;
  }
  return resolve(process.cwd(), "..", "..", "private-uploads", "originals");
}

export function resolveArchivesDir(): string {
  const override = process.env.ARCHIVES_DIR?.trim();
  if (override) {
    return override;
  }
  return resolve(process.cwd(), "..", "..", "private-uploads", "archives");
}
