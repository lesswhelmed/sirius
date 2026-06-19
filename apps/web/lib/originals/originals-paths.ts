// Web-side resolution of the PRIVATE originals + archives roots. Mirrors
// apps/worker/src/lib/originals-paths.ts and reads the SAME env vars so the
// worker (writer) and the web app (reader) always agree on where retained files
// live. These roots are NOT under public/ and are never served by Caddy — the
// only access is through the owner-/token-gated route handlers in this app.
//
// Defaults: web cwd is apps/web (PM2 + next), so "../../private-uploads/..."
// resolves to <repo>/private-uploads/... — the same absolute path the worker's
// own default (from apps/worker) targets.
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

export function resolveOriginalsDir(): string {
  const override = process.env.ORIGINALS_DIR?.trim();
  return (
    override ||
    resolve(process.cwd(), "..", "..", "private-uploads", "originals")
  );
}

export function resolveArchivesDir(): string {
  const override = process.env.ARCHIVES_DIR?.trim();
  return (
    override ||
    resolve(process.cwd(), "..", "..", "private-uploads", "archives")
  );
}

function ownerBucket(submittedById: string | null): string {
  return submittedById ?? "_anon";
}

// Best-effort removal of a submission's retained dir, called when the owner
// deletes a post. Kept in sync with the worker's removeRetainedForSubmission.
export function removeRetainedForSubmission(
  submittedById: string | null,
  submissionId: string,
): void {
  try {
    rmSync(
      join(resolveOriginalsDir(), ownerBucket(submittedById), submissionId),
      {
        recursive: true,
        force: true,
      },
    );
  } catch {
    // best-effort; a missing dir is fine (pre-feature posts have no originals)
  }
}
