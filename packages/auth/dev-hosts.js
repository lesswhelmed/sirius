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
// Contract for apps/mobile/.env: EXPO_PUBLIC_AUTH_BASE_URL must be
// `https://<host>` for one of these hosts (currently https://sirius.local so
// phones on the Wi-Fi resolve it via portless LAN/mDNS; the Mac and simulator
// resolve both names).
//
// Plain ESM JS (not TS) on purpose: next.config.js is loaded natively by Node
// before any transpilation, so the source of truth must be runnable as-is.
// Types live in dev-hosts.d.ts. Dev-only — production origins come from
// AUTH_TRUSTED_ORIGINS / BETTER_AUTH_URL env.
export const DEV_HOSTS = ["sirius.localhost", "sirius.local"];
