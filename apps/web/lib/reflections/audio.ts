// Storage + streaming resolution for reflection-response audio, the reflection
// analogue of lib/originals/originals-paths.ts. Audio answers live under the
// SAME private originals root the retained uploads use (NOT under public/,
// never fronted by Caddy), in a parallel bucket:
//
//   {ORIGINALS_DIR}/reflections/{userId}/{promptId}/answer.<ext>
//
// Keyed by promptId (not responseId): a prompt has at most one response (the
// unique promptId FK on ReflectionResponse), so the mapping is 1:1 and the key
// exists BEFORE the row does — no write-then-rename dance. Re-recording simply
// overwrites the file. Deletes leave the file on disk (tombstoned responses can
// revive; disk GC is out of scope).
//
// audioPath in the DB stores the RELATIVE pointer ("reflections/…"); every
// filesystem touch here re-resolves against the originals root and refuses
// anything that escapes it (defense in depth — the segments come from the
// session + DB, not user input, but the guard is cheap).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { resolveOriginalsDir } from "../originals/originals-paths";

// Small allowlist of audio containers the mobile/web recorders actually
// produce. Maps accepted MIME types to the on-disk extension.
const AUDIO_MIME_TO_EXT: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  wav: "audio/wav",
};

export const MAX_REFLECTION_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB

// Returns the storage extension for an allowlisted audio MIME type, or null
// when the type is not accepted (route answers 415).
export function reflectionAudioExtForMime(mime: string): string | null {
  return AUDIO_MIME_TO_EXT[mime.toLowerCase().split(";")[0]!.trim()] ?? null;
}

// Path segments are session/DB ids (cuid-ish); anything outside the safe
// alphabet is rejected outright rather than sanitized.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

function assertSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`unsafe ${label} for reflection audio path`);
  }
}

// The relative pointer stored in ReflectionResponse.audioPath.
export function reflectionAudioRelativePath(
  userId: string,
  promptId: string,
  ext: string,
): string {
  assertSegment(userId, "userId");
  assertSegment(promptId, "promptId");
  assertSegment(ext, "extension");
  return join("reflections", userId, promptId, `answer.${ext}`);
}

// Resolve a stored relative pointer to an absolute path confined to the
// originals root. Returns null when the pointer escapes the root (corrupt or
// tampered DB value) — callers treat that as not-found.
export function resolveReflectionAudioAbsolute(
  relativePath: string,
): { baseDir: string; absolutePath: string } | null {
  const baseDir = resolve(resolveOriginalsDir());
  const absolutePath = resolve(baseDir, relativePath);
  if (absolutePath !== baseDir && !absolutePath.startsWith(baseDir + sep)) {
    return null;
  }
  return { baseDir, absolutePath };
}

// Content type for a stored pointer, from its extension.
export function reflectionAudioContentType(relativePath: string): string {
  const ext = relativePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

// Persist the uploaded bytes and return the relative pointer to store on the
// response row. Overwrites any prior recording for the prompt (1:1 keying).
export async function saveReflectionAudio(input: {
  userId: string;
  promptId: string;
  ext: string;
  bytes: Uint8Array;
}): Promise<string> {
  const relative = reflectionAudioRelativePath(
    input.userId,
    input.promptId,
    input.ext,
  );
  const resolved = resolveReflectionAudioAbsolute(relative);
  if (!resolved) {
    throw new Error("reflection audio path escaped the originals root");
  }
  await mkdir(dirname(resolved.absolutePath), { recursive: true });
  await writeFile(resolved.absolutePath, input.bytes);
  return relative;
}
