# HANDOFF — mobile "unauthorized" on a stale session cookie

Status: **FIXED** on 2026-06-18 — app API calls now route through `authClient.$fetch`
(commit pending). The native cookie-jar divergence is eliminated; verified end-to-end on
the simulator. Residual follow-up: native cookie-jar hardening for `uploadFile`
(`expo-file-system`) and the SSE `EventSource` (see bottom).

## The fix that landed

Root cause was a divergence between two cookie paths: the app's raw `fetch` helpers in
`apps/mobile/src/lib/api.ts` did NOT set `credentials: "omit"`, so React Native's shared
NSURLSession cookie jar could send a STALE cookie → server 401 `{"error":"unauthorized"}`,
while better-auth's own requests (`credentials:"omit"` via the expo plugin) kept
`useSession()` valid — so the UI stayed logged-in and never redirected.

Fix: `apiGet`/`apiPostJson`/`apiSend` now call **`authClient.$fetch`** (inside the existing
`runWithAuthRetry` wrapper). `$fetch` runs the @better-auth/expo plugin's hooks, which set
`credentials:"omit"` + attach the stored cookie via `getCookie()` + persist rotated
`Set-Cookie` — identical to `useSession`/`getSession`/`signOut`, so the two paths can no
longer disagree. A small `unwrap()` helper maps `$fetch`'s `{data,error}` back to the
`ApiError` contract callers depend on (a no-HTTP-status result throws a plain `Error` so the
toxic-cookie/transport recovery still engages). `buildHeaders`/`parseResponse` were removed.
No call sites changed.

As a side effect this also closed the "stranded on inline unauthorized" gap: with the
false-401s gone, a genuinely dead session now flows 401 → `runWithAuthRetry` → `signOut()`
→ `useSession` null → the `(tabs)/_layout.tsx:25` guard redirects to sign-in.

Verified on the simulator: Queue/Catalog/Space(embedding-scene)/projects (`apiGet`), create
focus area (`apiPostJson`), archive (`apiPatch`), delete (`apiDelete`), and the forced-logout
path (deleted the user's `session` rows → app redirected to sign-in instead of stranding →
re-login → all green). `bun run check-types` + lint pass.

---

## Original diagnosis (for reference)

Status when first written: **diagnosed, not fixed** (user opted for diagnose-only on 2026-06-18).
Immediate symptom was resolved on the simulator by signing out + back in.

## Symptom

On the iOS Simulator the app showed an **"unauthorized"** error. Concretely: the
**Queue** tab rendered "Couldn't load queue / unauthorized" with a Retry button,
while the tab bar (Capture / Catalog / Queue / Tree) stayed visible — i.e. the app
looked logged-in but a feature failed with `unauthorized`.

## Root cause (proven)

The device's **persisted session cookie had gone stale and the server was rejecting
it** on every _live_ authenticated API call (`401 {"error":"unauthorized"}`), but the
app stayed "logged in" off a **cached session**, so the user saw an inline error
instead of a re-login prompt.

Why it presented the way it did:

- `/api/app/queue` is a **live** `apiGet` call (`apps/mobile/src/lib/api.ts` →
  raw `fetch` + manual `Cookie: authClient.getCookie()` header, `api.ts:188`). The
  server's `getSessionOrNull()` saw no valid session → `401 {"error":"unauthorized"}`
  (`apps/web/app/api/app/queue/route.ts:14`).
- The **Catalog** tab kept working because it reads the **local SQLite mirror**
  (offline-first sync), not the live API — so it showed stale local data.
- `useSession()` uses better-auth's own fetch/cache and kept the UI logged-in, so the
  app never redirected to sign-in.

### Evidence collected

1. Server healthy over `https://sirius.local`:
   - `POST /api/auth/sign-in/email` with real dev creds → `200` + `set-cookie`.
   - `GET /api/app/queue?limit=50` **with** that fresh cookie → `200` + full queue.
   - Same endpoint **without** a cookie → `401 {"error":"unauthorized"}` (exact
     on-screen string).
2. DB had **valid, non-expired** sessions for the user (expiring 06-25) — not an
   expiry/DB-wipe problem.
3. On the sim: Queue (live API) = unauthorized; Catalog (local mirror) = fine.
4. **Decisive test:** signed out + signed back in on the sim → **Queue loads**
   ("In progress" + items). Fresh cookie fixes it.

### Likely trigger (inferred, not fully confirmed)

The stored cookie desynced from the server during dev. Most probable: the cookie's
HMAC no longer verified against the current `BETTER_AUTH_SECRET` (a secret change /
server state change during dev would reject the old cookie's signature even though
the session row is still valid), or the stored cookie value was otherwise stale.
`packages/auth/src/index.ts` uses **default** better-auth session config (7-day
`expiresIn`, no `cookieCache`), confirmed during investigation.

## The real gap to fix later

The app **should auto-recover** by forcing sign-out → redirect to sign-in when live
requests keep returning 401, instead of stranding the user on a permanent inline
"unauthorized." The retry/logout machinery already exists but did **not** redirect in
this case:

- `runWithAuthRetry` (`apps/mobile/src/lib/api.ts:112–184`): on 401/403 it rechecks
  the session (`getSession({ disableCookieCache: true })`) and, after
  `MAX_AUTH_RETRIES`, calls `signOut()` so the root layout's `useSession()` redirects.
- Observed behavior: the user stayed logged-in with the inline error, so this path
  did **not** effectively sign out / redirect. The session recheck (better-auth's
  fetch) and the live `apiGet` (manual `getCookie()` header) **disagreed** — recheck
  apparently reported the session usable while the live call kept 401ing — and the
  user was never bounced to sign-in.

### Recommended fix direction (to validate first)

1. Reproduce with runtime logging to confirm the mechanism: log, inside
   `runWithAuthRetry`, the recheck `SessionState`, the attempt count, whether
   `signOut()` is reached, and whether `useSession()` actually flips to null. The open
   question is **why** a 401-on-live-request + "valid" recheck does not end in a
   redirect.
2. If recheck reports "valid" but live calls persistently 401 (a stale/desynced local
   cookie the recheck can't reconcile), treat that as authoritative: clear the stored
   cookie/session and force sign-out so the user re-logs in (the only real recovery).
   Consider unifying the two cookie paths so `apiGet` and `useSession` can't disagree
   (e.g. route app API calls through the better-auth client's fetch, or re-sync
   `getCookie()` from the same source the recheck refreshes).
3. Add an integration-style check that a rejected stored cookie reliably lands the
   user on sign-in (not a stuck inline error).

## Workaround for now

Sign out and sign back in on the device — refreshes the stored cookie. Verified to
fix it on the simulator on 2026-06-18.
