// Gemini API-key resolution for the classifier call. Kept as a tiny local copy
// (rather than importing @repo/db, which would pull Prisma into this pure
// classifier package) but MUST resolve the SAME env vars as @repo/db's
// embed-client so the worker and web hit the same key. If that list ever
// changes, keep the two in sync.
export function resolveApiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY
  );
}

export function requireApiKey(): string {
  const key = resolveApiKey();
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY environment variable required (see .env.example)",
    );
  }
  return key;
}
