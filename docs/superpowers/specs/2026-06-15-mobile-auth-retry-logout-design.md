# Mobile auth retry → logout

**Date:** 2026-06-15
**Status:** Approved (design)

## Goal

When an authenticated API request from the mobile app fails with an
authentication error, the app should **retry up to 3 times with exponential
backoff, re-checking the session between attempts**, and only **sign the user
out** if the session is still unauthenticated after the retries.

The point of the retries is recovery: a 401 caused by a transient blip or a
session that can refresh should be survivable without bouncing the user to the
sign-in screen. A genuinely dead session still ends in logout, just not on the
first failure.

## Where it lives

All logic lands in the central client `apps/mobile/src/lib/api.ts`. Every
authenticated helper (`apiGet`, `apiPostJson`, `apiPatch`, `apiDelete`,
`apiSend`, `uploadFile`) routes through one core request path that owns the
policy. No component or screen changes.

## Behavior

On a response with status **401 or 403**:

1. Re-check the session with a forced server hit:
   `authClient.getSession({ query: { disableCookieCache: true } })`
   (bypasses better-auth's cookie cache so we see the real server state).
2. If the session is **valid again** → immediately re-issue the original
   request with the refreshed cookie.
3. If still **unauthenticated** → wait `backoff(attempt)`, then loop.
4. Cap at **3 retries**. After 3 attempts with no recovery → call `signOut()`
   and throw the original `ApiError`.

Logout navigation is implicit: `signOut()` clears the better-auth session, and
the reactive `useSession()` in the root layout (`src/app/index.tsx` /
`(tabs)/_layout.tsx`) redirects to `/(auth)/sign-in`. `api.ts` does **not**
import the router.

## Backoff

Exponential with jitter, reusing the shape already in `src/lib/sync/sse.ts`:
`base = min(maxMs, baseMs * 2 ** attempt)`, then jitter in `[base/2, base)`.

- `baseMs = 500`
- `maxMs = 4000`
- attempts: 3 → roughly 0.5s, 1s, 2s between tries.

## Concurrency (single-flight)

Multiple requests can 401 simultaneously. We must not fan out into N session
re-checks or N logouts.

- A module-level `inFlightRecheck: Promise | null` dedupes the session
  re-check — concurrent 401s await the same promise.
- A module-level `loggedOut` latch: once `signOut()` fires, subsequent
  in-flight requests fail fast (throw their `ApiError`) without re-triggering
  `signOut()`. Reset on successful re-auth.

## Method safety

Retrying any HTTP method on a 401/403 is safe: the server rejected the request
before processing it, so there is no double-submit risk on POST/PATCH.

## Out of scope (deliberate)

- `src/lib/outbox.ts` — owns its own flush loop and treats 4xx as a permanent
  drop. Left unchanged: a queued submission failing on 401 will not trigger this
  logout flow.
- `src/lib/sync/sse.ts` — the SSE stream has its own reconnect backoff and does
  not route through `api.ts`.
- Auth endpoints themselves (sign-in/sign-up) are not wrapped.

## Testing

No test runner is wired in this repo (per CLAUDE.md). Verify against the running
app: force a 401 (e.g. invalidate the session server-side), confirm the retry
timing, session re-check, and eventual redirect to sign-in.
