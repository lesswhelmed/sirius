// Stages uploaded image bytes outside the request hot-path so the route can
// finish quickly and the worker can move them into apps/web/public/sight/...
// at insert time. Lives at INGEST_STAGING_DIR (default /tmp/sirius-ingest).
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_DIR = "/tmp/sirius-ingest";

function getStagingDir(): string {
  return process.env.INGEST_STAGING_DIR?.trim() || DEFAULT_DIR;
}

function ensureStagingDir(): string {
  const dir = getStagingDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function stageBytes(
  submissionId: string,
  bytes: ArrayBuffer | Uint8Array,
  extension: string,
  // Optional hard ceiling. submit{Image,File}Ingest already reject over-cap
  // bodies with a 413 before staging, so this is defense-in-depth: it only trips
  // on a programming error, and fails loudly rather than writing an unbounded
  // file to the staging disk.
  maxBytes?: number,
): Promise<string> {
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
    throw new Error(
      `staged payload ${bytes.byteLength} bytes exceeds the ${maxBytes}-byte cap`,
    );
  }
  const dir = ensureStagingDir();
  const filePath = join(dir, `${submissionId}.${extension}`);
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes as ArrayBuffer);
  await writeFile(filePath, buffer);
  return filePath;
}

export function removeStagedFile(filePath: string | null | undefined): void {
  if (!filePath) {
    return;
  }
  try {
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
    }
  } catch {
    // best-effort cleanup; staged files are not load-bearing once persisted
  }
}
