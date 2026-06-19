// Shared helpers for building downloadable text/markdown exports of a post.
// Used by the post export route (full post + front matter) and the owner-only
// notes-as-text route.

export function safeFilename(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function toFrontMatter(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  }
  if (value == null) return "";
  return JSON.stringify(value);
}

// Serializes a key→value map into a `key: value` front-matter block, dropping
// null/undefined entries.
export function buildFrontMatter(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${toFrontMatter(v)}`)
    .join("\n");
}
