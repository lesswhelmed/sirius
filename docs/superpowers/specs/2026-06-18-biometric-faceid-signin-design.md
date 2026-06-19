# Design: Face ID sign-in + autofill fix (mobile)

Date: 2026-06-18
Status: Approved (brainstorming complete; ready for implementation plan)
App: `apps/mobile` (Expo SDK 56, RN 0.85 New Architecture / Fabric, better-auth Expo client)

## Problem

1. On the mobile sign-in / sign-out screens, OS autofill (Face ID / Keychain) sometimes
   leaves the email or password input **empty** despite the biometric prompt succeeding —
   the user is stuck on a login screen they cannot complete.
2. There is no biometric login. Returning users must rely on OS autofill (which is the very
   thing that fails) or retype credentials.

## Root cause of the autofill bug

Controlled `TextInput` (value + onChangeText) under the iOS New Architecture (Fabric):
- Fabric can **recycle** the native input node after Password Autofill, after which it stops
  propagating value updates — the field renders empty. (React Native issue
  [#53050](https://github.com/facebook/react-native/issues/53050).)
- Strong-password / "Choose my own password" autofill paths can fire `onChangeText` with an
  **empty string**, clobbering controlled state. (React Native issue
  [#23921](https://github.com/facebook/react-native/issues/23921).)

## Decisions (locked)

- **Biometric model:** Face ID sign-in as a **credential vault** (not app-lock).
- **Vault contents:** email + password, stored **only** in the iOS Keychain behind the
  Secure Enclave (`requireAuthentication`), device-only.
- **Settings home:** a **new Settings screen**; Sign out **moves** here from Composer.
- **Entry point:** a **gear icon in the Catalog (Library) header** (keeps the 4-tab IA).

## Scope

In scope:
- `expo-local-authentication` install + config plugin.
- New `src/lib/biometric-auth.ts` vault module.
- Sign-in screen: "Sign in with Face ID" path + post-login enable prompt + invalidation guard.
- New Settings screen (account, Face ID toggle, Sign out).
- Gear entry point in the Catalog header.
- Autofill resilience fix on the auth screens.

Out of scope (YAGNI):
- App-lock / foreground re-auth gate.
- Android-specific tuning (code is Android-safe via capability guards, but iOS is the
  verified target).
- Any server / better-auth config change. `AUTH_TRUSTED_ORIGINS` is unaffected.

## Packages

- **Add** `expo-local-authentication` via `bun expo install` (SDK-56-matched version).
- **Add** its config plugin to `app.json`:
  `["expo-local-authentication", { "faceIDPermission": "Allow Sirius to use Face ID to sign you in." }]`
  (writes `NSFaceIDUsageDescription`).
- `expo-secure-store` — already installed; already has its config plugin. We use its native
  `requireAuthentication` keychain ACL.
- Adding a native module changes a native input, so the next `bun run dev` runs a clean
  prebuild + pod install (via `prebuild-if-native-changed.mjs`) and `verify:native-ai`.
  This requires a **dev-client binary rebuild** — it cannot ship as an OTA update.

## Module: `src/lib/biometric-auth.ts`

Single-purpose vault. Keys mirror the `siriusapp` storage prefix convention used elsewhere.

Public surface:
- `getBiometricCapability(): Promise<{ available: boolean; type: 'face' | 'touch' | 'none' }>`
  — `hasHardwareAsync()` && `isEnrolledAsync()`; `type` from `supportedAuthenticationTypesAsync()`
  for correct "Face ID" vs "Touch ID" labeling.
- `isBiometricEnabled(): boolean` — sync read of a non-sensitive flag key.
- `getEnrolledEmail(): string | null` — non-sensitive saved email (for "Sign in as you@…").
- `enableBiometric(email, password): Promise<void>` — writes `{ email, password }` JSON to a
  dedicated gated key with options:
  `{ requireAuthentication: true, keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY, authenticationPrompt: "…" }`;
  also writes the non-gated enabled flag + email.
- `getBiometricCredentials(): Promise<{ email, password } | null>` —
  `getItemAsync(key, { requireAuthentication: true })`. The keychain ACL itself raises the
  native Face ID prompt — **single prompt, no double-auth**. Returns `null` on cancel/fail.
- `disableBiometric(): Promise<void>` — deletes the gated key + the flag + email.

Design note: the Secure Enclave ACL is the authority for the gate. `expo-local-authentication`
is used only for capability detection + labeling, never for a second prompt.

## Sign-in flow (`src/app/(auth)/sign-in.tsx`)

- On mount: if `isBiometricEnabled()`, render a prominent **"Sign in with Face ID"** (or
  "…with Touch ID") button above the form, optionally showing the enrolled email.
- Tap → `getBiometricCredentials()` → on success, run the existing
  `clearAuthStorage("pre-sign-in")` then `signIn.email`. Cancel/fail → fall back to the manual
  form silently (no error leak).
- After a **successful manual** sign-in: if biometrics available and not enabled, prompt
  "Enable Face ID for next time?" → `enableBiometric(email, password)`.
- **Credential-invalidation guard:** if a Face-ID sign-in returns 401 (password changed
  server-side), call `disableBiometric()` and surface "Your saved password changed — please
  sign in again."

## Settings screen (`src/app/settings.tsx`, root Stack route)

- Reached via a gear icon button in the Catalog header.
- Sections:
  - **Account** — email / handle from `useSession()`.
  - **Security** — Face ID toggle (`Switch`).
    - Enable from Settings (password not held post-login): show a "Confirm your password"
      sheet, verify via a real sign-in call, then `enableBiometric`. (Confirming identity
      before arming biometrics is also the more secure path.)
    - Disable: `disableBiometric()` (wipes the vault).
    - Toggle hidden/disabled when `getBiometricCapability().available` is false.
  - **Sign out** — relocated from Composer; on press `signOut()` then
    `router.replace("/(auth)/sign-in")`. The vault is wiped on sign-out.

## Autofill fix (auth screens only)

Do **not** change the shared `Field` (used widely as a controlled input). Instead, on the
auth screens convert the email/password inputs to the **uncontrolled ref pattern**:
- `defaultValue` + capture the native value into a `ref` via **both** `onChangeText` and
  `onEndEditing` (the latter still carries the final native text when `onChangeText` was
  skipped by the recycling bug). Read the refs at submit.
- Correct content types: username → `textContentType="username"` + `autoComplete="email"`;
  password → `textContentType="password"`; sign-up new password → `textContentType="newPassword"`.

This makes React re-renders unable to clobber native text and guarantees the submitted value
reflects whatever autofill / the user entered.

## Privacy & security posture

- Credentials live only in the iOS Keychain via SecureStore, Secure-Enclave-gated
  (`requireAuthentication`), `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` → not in device backups,
  not iCloud-synced, wiped if the device passcode is removed, device-bound.
- Never logged; never transmitted anywhere except the existing HTTPS better-auth sign-in.
- Vault wiped on: disable, sign-out, and server credential-invalidation (401).
- Android parity is free (same APIs → BiometricPrompt + Android Keystore), guarded by
  capability checks; iOS is the verified target.

## Verification (no test runner exists in this repo)

Manual checklist on a dev-client build (FaceID requires a dev build, not Expo Go — already used):
- Simulator: **Features → Face ID → Enrolled**, then Matching / Non-matching Face to exercise
  success, cancel, and fail.
- Enable at login → kill app → relaunch → "Sign in with Face ID" succeeds.
- Settings toggle: enable (with password confirm) and disable; disable wipes the vault.
- Server password change → Face-ID sign-in 401 → vault auto-wipes, user re-signs in.
- Autofill: email + password land **non-empty** on the sign-in screen.

## Files

New:
- `apps/mobile/src/lib/biometric-auth.ts`
- `apps/mobile/src/app/settings.tsx`

Modified:
- `apps/mobile/app.json` (add `expo-local-authentication` plugin)
- `apps/mobile/package.json` (add dependency)
- `apps/mobile/src/app/(auth)/sign-in.tsx` (Face ID button, enable prompt, autofill fix)
- `apps/mobile/src/app/(auth)/sign-up.tsx` (autofill fix)
- `apps/mobile/src/app/(tabs)/composer.tsx` (remove Sign out)
- `apps/mobile/src/app/(tabs)/library.tsx` (Catalog header gear → Settings)
- `apps/mobile/src/app/_layout.tsx` (register the `settings` Stack route if needed)
