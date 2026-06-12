// THE one place to configure local dev hostnames.
//
// Purpose (first principles): the dev stack is served by portless under stable
// HTTPS names, and every layer that screens origins must agree on them. Add or
// change a hostname HERE and every consumer follows:
//
//   - apps/web/next.config.js  → `allowedDevOrigins` (Next 16 blocks cross-origin
//     dev requests from unlisted hostnames)
//   - packages/auth/src/index.ts → `devTrustedOrigins` (better-auth rejects
//     logins from untrusted origins; derives `https://<host>` from this list)
//
// Contract for env files: EXPO_PUBLIC_AUTH_BASE_URL (apps/mobile/.env) and
// BETTER_AUTH_URL / NEXT_PUBLIC_BETTER_AUTH_URL (root .env) must be
// `https://<host>` for one of these hosts. IMPORTANT: the portless proxy
// serves ONE name per mode — LAN mode (`--lan`, the current default via
// dev:proxy) serves ONLY `sirius.local` (sirius.localhost 404s); non-LAN mode
// serves only `sirius.localhost`. Both stay whitelisted here so switching
// modes is an env-value change, not a config hunt.
//
// Plain ESM JS (not TS) on purpose: next.config.js is loaded natively by Node
// before any transpilation, so the source of truth must be runnable as-is.
// Types live in dev-hosts.d.ts. Dev-only — production origins come from
// AUTH_TRUSTED_ORIGINS / BETTER_AUTH_URL env.
export const DEV_HOSTS = ["sirius.localhost", "sirius.local"];
