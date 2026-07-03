# CP1 — Auth & account lifecycle

Everything between "stranger" and "signed-in user with a handle", plus the exit
paths (sign-out, account deletion). Auth is one `betterAuth` instance in
`packages/auth/src/index.ts` (email+password, **required email verification**,
Resend for mail); Next.js mounts it at `/api/auth/[...all]`.

> Last full pass: ⏳ not yet run · Statuses: ✅ verified · ◑ partial · ⏳ not run

**Shared anchors:** `packages/auth/src/index.ts`, `packages/auth/src/email.ts`,
`apps/web/app/(auth)/`, `apps/web/app/(app)/layout.tsx`

---

### AUTH-1 · Sign-up with Terms agreement  `P0` ⏳

**Preconditions:** an email inbox you can read (or DB access to fish out the
verification token). Not signed in.

**Steps:**
1. Visit `/sign-up`. Fill name, email, password. Leave the Terms checkbox
   **unchecked**; submit.
2. Check the Terms checkbox (links to `/terms` and the privacy policy must
   open in a new tab); submit again.

**Expected:**
- Step 1 blocks with "You must agree to the Terms of Use and Privacy Policy."
  — no account created.
- Step 2 creates the account and lands on the "verify your email" state; a
  verification email arrives via Resend.
- Signing in **before** verifying is refused (email verification is required).

**Ground truth:**
```sh
q "select \"emailVerified\", \"termsAcceptedAt\" is not null from \"user\" where email='<email>'"
# → f | t   (unverified, but terms stamped at creation)
```

**Anchors:** `apps/web/app/(auth)/sign-up/page.tsx`,
`apps/web/app/(public)/terms/page.tsx`, `packages/auth/src/index.ts`

---

### AUTH-2 · Email verification link  `P1` ⏳

**Preconditions:** AUTH-1 account, unverified.

**Steps:**
1. Open the verification link from the email (or via `/verify-email`).
2. Sign in.

**Expected:** link marks the account verified; sign-in now succeeds and
redirects into the app.

**Ground truth:** `q "select \"emailVerified\" from \"user\" where email='<email>'"` → `t`

**Anchors:** `apps/web/app/(auth)/`, `packages/auth/src/email.ts`

---

### AUTH-3 · Sign-in happy path + session-gated redirect  `P0` ⏳

Automated: `scripts/testing/signin.sh` covers the web flow.

**Steps:**
1. Signed out, visit any `(app)` route (e.g. `/queue`) → expect redirect to `/sign-in`.
2. Sign in with a verified account.
3. Reload the app — session persists.

**Expected:** redirect-to-sign-in when signed out; after sign-in the originally
requested surface renders; session survives reload.

**Anchors:** `apps/web/app/(app)/layout.tsx` (`requireSession`),
`apps/web/app/(auth)/sign-in/page.tsx`

---

### AUTH-4 · Forgot / reset password  `P1` ⏳

**Steps:**
1. `/sign-in` → forgot password → submit the account email.
2. Open the reset link from the email; set a new password.
3. Sign in with the **old** password, then the **new** one.

**Expected:** reset email arrives; old password rejected; new password works.
Existing sessions on other devices should no longer be trusted after reset.

**Anchors:** `apps/web/app/(auth)/`, `packages/auth/src/email.ts`

---

### AUTH-5 · Handle setup gate  `P0` ⏳

**Preconditions:** a signed-in user whose `handle` is NULL (fresh account).

**Steps:**
1. Visit any `(app)` route.
2. Complete the handle form at `/setup-handle`.

**Expected:** every `(app)` route redirects to `/setup-handle` until a handle
exists; afterwards the app renders and the handle appears in the session
(mobile depends on this — handle is a betterAuth `additionalFields` column).

**Ground truth:** `q "select handle from \"user\" where email='<email>'"`

**Anchors:** `apps/web/app/(app)/layout.tsx`, `packages/auth/src/index.ts`
(`user.additionalFields`)

---

### AUTH-6 · Legacy-account Terms gate  `P1` ⏳

Covered in depth as [MOD-6](CP5-moderation-safety.md); listed here because it
sits in the auth-adjacent app shell.

**Steps:** null out `termsAcceptedAt` for a test user
(`q "update \"user\" set \"termsAcceptedAt\"=null where email='<email>'"`),
reload any `(app)` page.

**Expected:** the blocking Terms panel renders **instead of** the app; Accept
POSTs `/api/app/account/accept-terms` and the app renders on refresh.

**Anchors:** `apps/web/app/(app)/_chrome/terms-gate.tsx`,
`apps/web/app/api/app/account/accept-terms/route.ts`

---

### AUTH-7 · Mobile sign-in / sign-up parity  `P0` ⏳

**Preconditions:** dev build on the simulator; `EXPO_PUBLIC_AUTH_BASE_URL`
pointing at the running web app (`https://sirius.local` in dev).

**Steps:**
1. Fresh install (or signed out) → app shows the auth screens.
2. Sign in with the dev account.
3. Background the app, relaunch — still signed in.
4. Sign out from the Account tab.

**Expected:** sign-in succeeds via the better-auth Expo client; session
persists across relaunch (SecureStore cookie); sign-out returns to the auth
screens and clears the session.

Known failure modes to watch for (both have memory entries): a corrupt
persisted cookie makes **every** request fail with "fetch failed"
(reinstall-only recovery), and a stale cookie yields "unauthorized" on live
API calls while the UI still looks signed in.

**Anchors:** `apps/mobile/src/app/(auth)/sign-in.tsx`,
`apps/mobile/src/app/(auth)/sign-up.tsx`, `apps/mobile/src/lib/auth-client.ts`,
`packages/auth/src/index.ts` (`expo()` plugin, `siriusapp://` trusted origin)

---

### AUTH-8 · Account deletion (mobile)  `P0` ⏳

App Store requirement: in-app account deletion must exist and must destroy the
data.

**Preconditions:** a **disposable** test account with a few posts and uploads.
Never run against a real account.

**Steps:**
1. Account tab → Delete account.
2. Confirm the destructive alert; enter the password when prompted.
3. Try to sign in with the deleted credentials.

**Expected:**
- Password is re-verified server-side (wrong password → error, account intact).
- On success the app clears local auth storage and returns to sign-in.
- Sign-in with the old credentials fails; the user's posts are gone.

**Ground truth:**
```sh
q "select count(*) from \"user\" where email='<email>'"                    # → 0
q "select count(*) from \"Post\" where \"submittedById\"='<old-user-id>'"  # → 0
```

**Anchors:** `apps/mobile/src/app/(tabs)/settings.tsx` (`handleDeleteAccount`),
`packages/auth/src/index.ts` (`deleteUser`)
