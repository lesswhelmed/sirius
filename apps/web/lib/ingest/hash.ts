// Content hashes drive dedup via the IngestSubmission.contentHash unique index.
// `force=true` salts the URL hash with Date.now() so a user-forced re-ingest
// bypasses the dedup short-circuit.
import { createHash } from "node:crypto";

export function contentHashForUrls(
  urls: string[],
  notes: string,
  force: boolean
): string {
  const sorted = [...urls].map((u) => u.trim()).sort();
  const base = JSON.stringify({ urls: sorted, notes: notes.trim() });
  const seed = force ? `${base}|force:${Date.now()}` : base;
  return createHash("sha256").update(seed).digest("hex");
}

export function contentHashForBytes(
  bytes: ArrayBuffer | Uint8Array | Buffer
): string {
  const buf = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes as ArrayBuffer);
  return createHash("sha256").update(buf).digest("hex");
}

// Dedup identity for an image batch MEMBER is its slot (batchId, imageIndex),
// not its raw bytes. The contentHash unique index is global, so a pure-bytes
// hash makes a duplicate photo — the same image twice in one batch, or one ever
// submitted before — collide with an existing row under a DIFFERENT batchId.
// That returns a "deduped" row instead of creating this batch's slot, leaving
// the batch permanently short of totalCount so the worker never writes the SIGHT
// post. Folding batchId + imageIndex in fixes that while keeping in-flight retries
// idempotent: re-posting the SAME slot (same batchId+imageIndex+bytes) still hashes
// identically and dedups. Bytes stay in the digest so an accidental same-slot
// re-post with different content is still treated as the same slot.
export function contentHashForImage(
  bytes: ArrayBuffer | Uint8Array | Buffer,
  batchId: string,
  imageIndex: number
): string {
  const buf = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes as ArrayBuffer);
  return createHash("sha256")
    .update(`${batchId}:${imageIndex}:`)
    .update(buf)
    .digest("hex");
}
