// Canonical public origin for the marketing surface — used by metadataBase,
// sitemap, robots, and OpenGraph URLs. Prefer an explicit NEXT_PUBLIC_SITE_URL;
// fall back to the auth origin (same host in prod), then the production domain.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL ??
  "https://lesswhelmed.com"
).replace(/\/$/, "");

export const SITE_NAME = "Lesswhelmed";
