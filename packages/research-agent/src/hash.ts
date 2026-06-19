// Stable content hash used to decide whether a post needs (re)embedding. Hashed
// over the exact text we embed (title + body), so an edit changes it and an
// untouched post keeps it — letting the vector store skip work idempotently.
//
// FNV-1a (32-bit) returned as hex: tiny, dependency-free, deterministic across
// hosts (so the mobile and a future web client agree on what's "the same post").
// This is NOT a cryptographic hash and NOT the server's provider `contentDigest`
// (which is metadata, not content) — collisions are astronomically unlikely for
// this use and the cost of one would only be a missed re-embed of a single post.
export function contentHash(title: string, body: string): string {
  const input = `${title}\n${body}`;
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit unsigned space via Math.imul + >>> 0.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
