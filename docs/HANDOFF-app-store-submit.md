# Handoff: submit the iOS app to App Store Connect

This is the manual step you (the human with Apple credentials) run. Claude produced
the production build; this doc is the exact path from "finished build" → "binary in
App Store Connect".

## State as of this handoff (2026-06-13)

- **Server URL is wired for prod.** The mobile production build talks to
  `https://lesswhelmed.com`. Verified across three places:
  - `apps/mobile/eas.json` → `build.production.env.EXPO_PUBLIC_AUTH_BASE_URL = https://lesswhelmed.com`
  - `.env.production` → `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`,
    `EXPO_PUBLIC_AUTH_BASE_URL` all `= https://lesswhelmed.com`; `AUTH_TRUSTED_ORIGINS = siriusapp://`
  - root `.env` (dev) also already trusts `siriusapp://`
  - So the prod server accepts the mobile app's `siriusapp://` auth callback. No `.env` change needed.
- **Production build:** `eas build --profile production --platform ios` →
  **v1.0.0 (3)**, build id `e0f6d945-1715-44ca-9c1b-13a2bb820dbc`.
  Watch: <https://expo.dev/accounts/minasaleeb/projects/sirius/builds/e0f6d945-1715-44ca-9c1b-13a2bb820dbc>
- **EAS credentials:** distribution cert + provisioning profiles for both
  `dev.copt.sirius` and `dev.copt.sirius.share-extension` are active (Apple Team
  `L7U86T3YRV`, valid to 2027-06-01). No credential setup needed.
- **No App Store Connect record exists yet.** `eas submit` has never run for iOS, and
  `eas.json` → `submit.production.ios.ascAppId` is intentionally omitted. The first
  submit creates the App Store Connect app and discovers the ID.

## Step 1 — wait for the build to finish

```sh
cd apps/mobile
eas build:view e0f6d945-1715-44ca-9c1b-13a2bb820dbc   # status must be FINISHED
```

## Step 2 — submit to App Store Connect (interactive Apple login)

```sh
cd apps/mobile
eas submit --profile production --platform ios --latest
```

What it will prompt for (because no ASC app record exists yet):

1. **Apple ID login + 2FA** — sign in with the Apple account on Team `L7U86T3YRV`.
2. **Create the App Store Connect app?** → yes. It needs:
   - **Name:** `Sirius` (must be unique across the App Store; pick an alternate if taken)
   - **Bundle ID:** `dev.copt.sirius` (already registered from the builds)
   - **SKU:** any stable internal string, e.g. `dev-copt-sirius`
   - **Primary language:** e.g. English (U.S.)
3. It uploads the `.ipa`. App Store Connect then "processes" the build (a few minutes
   to ~1 hr) before it shows up under TestFlight / for review.

> Non-interactive alternative (CI/automation): create an App Store Connect API key
> (`.p8` + Key ID + Issuer ID), then
> `EXPO_APPLE_API_KEY_PATH=... EXPO_APPLE_API_KEY_ID=... EXPO_APPLE_API_ISSUER_ID=... eas submit --profile production --platform ios --latest --non-interactive`.

## Step 3 — backfill `ascAppId` so future submits are non-interactive

After the first submit, get the app's numeric Apple ID (App Store Connect → your app →
App Information → "Apple ID", digits only). Put it in `apps/mobile/eas.json`:

```jsonc
"submit": {
  "production": {
    "ios": {
      "appleTeamId": "L7U86T3YRV",
      "ascAppId": "1234567891"   // <-- backfill the real numeric ID here
    }
  }
}
```

Commit that change.

## Step 4 — finish the listing in App Store Connect (web, not EAS)

`eas submit` only uploads the binary. To actually ship you still need, in the App Store
Connect web UI: app metadata, screenshots, privacy details, app icon/category, and then
**Submit for Review**. That part is not automatable here.

## If the build ERRORS

The two dev-client builds on 2026-06-11 errored in the "Configure expo-updates" phase —
that was the `development` profile, unrelated to `production`. If *this* production build
errors, open the build logs URL above, read the failing phase, and fix at the source
(don't work around it) — then re-run Step 1's `eas build` command. Ask before changing
build config.
