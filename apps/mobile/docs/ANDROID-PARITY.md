# Android parity + emulator runbook

> **Shipping to Google Play?** This file is about **local emulator** parity testing. For
> the **EAS cloud production build + Play submit** runbook (server-URL env, fingerprint
> pitfall, service-account key), see [`ANDROID-BUILD.md`](./ANDROID-BUILD.md).

> **Status:** PLAN — no code changed yet. This file is the single source of truth for
> bringing the Sirius mobile app to feature parity on Android and running it on an
> Android emulator for manual testing. Written 2026-06-26 after a full code review of
> `apps/mobile`. Decisions already made by the owner are marked **[DECIDED]**; work that
> needs the owner are marked **[NEEDS OWNER]**.

---

## 0. TL;DR

The app is already ~90% cross-platform. `apps/mobile/android/` is prebuilt with correct
intent filters, permissions, and an adaptive icon. There is exactly **one hard blocker**
for running on the emulator (the dev server is addressed via the portless mDNS name
`https://sirius.local`, which an Android emulator cannot resolve) plus a short list of
intentionally-iOS-only features. Once the network fix lands, the app should boot and
function on the `penguin` AVD already on this Mac.

**Decisions captured:**
- **[DECIDED] Scope:** Plan/context file first → owner reviews → then implement.
- **[DECIDED] Emulator networking:** `10.0.2.2` + plain HTTP (emulator's alias for the Mac host loopback).
- **[DECIDED] RevenueCat:** Wire the Android key now (needs the Google Play public SDK key — see §6).

---

## 1. Tooling state on this machine (verified 2026-06-26)

| Tool | State | Notes |
| --- | --- | --- |
| `adb` | ✅ `1.0.41` | `/opt/homebrew/.../platform-tools/adb` |
| `sdkmanager` | ✅ present | `/opt/homebrew/bin/sdkmanager` |
| `emulator` | ✅ present | `$ANDROID_HOME/emulator` |
| AVD | ✅ **`penguin`** | Pixel 6, **API 34, arm64-v8a, Google APIs**, RAM **2 GB** |
| SDK platform | ✅ `android-34` only | matches the AVD |
| build-tools | ✅ `34.0.0` | |
| Gradle wrapper | ✅ `9.3.1` | very new; supports JDK 17–24 |
| `ANDROID_HOME` | ✅ `/opt/homebrew/share/android-commandlinetools` | Gradle finds the SDK via this |
| `ANDROID_SDK_ROOT` | ⚠️ **unset** | harmless (ANDROID_HOME is enough) but set it for safety |
| JDK | ⚠️ **23.0.2 / 23.0.1 / 1.8** — no JDK 17 | 23 *should* work with Gradle 9.3.1; JDK 17 is the safe fallback |
| Android Studio | ❌ not installed | command-line tools only — fine for `expo run:android` |
| `android/local.properties` | ❌ none | `expo run:android` generates it; or create `sdk.dir=$ANDROID_HOME` |

**Gotchas this implies:**
1. **AVD RAM is only 2 GB.** The on-device AI feature loads a ~2 GB 3B GGUF model — it will
   almost certainly OOM on this AVD. For general app testing it's fine; to exercise
   on-device AI, bump the AVD to ≥6 GB (see §7) or test that feature on a physical device.
   `arm64-v8a` is the right image on Apple Silicon (native speed via Hypervisor).
2. **JDK 23 is the default.** Try the build as-is first. If Gradle/AGP rejects the Java
   version, install Temurin 17 (`brew install --cask temurin@17`) and point `JAVA_HOME` at
   it for the build only.

---

## 2. Feature parity matrix (iOS → Android)

Legend: ✅ works cross-platform · 🟡 degraded but functional · 🔧 needs work this session · ⛔ iOS-only by design

| Feature | Android status | Detail / file |
| --- | --- | --- |
| Routing, tabs, all screens | ✅ | expo-router; no platform forks in navigation |
| Deep links (`siriusapp://…`) | ✅ | `android/.../AndroidManifest.xml` intent filters; rewriting in `src/app/+native-intent.ts` |
| Share intent (text/image, single + multi) | ✅ | `expo-share-intent` declares Android filters; `SEND`/`SEND_MULTIPLE` present in manifest. **Nav fix (2026-06-26):** Android emits no share URL, so the iOS `+native-intent` redirect never fired and shares dead-ended on Catalog. Added Android-only `ShareIntentNavigator` in `src/app/_layout.tsx` that pushes `/shareintent` off the `hasShareIntent` event. |
| Biometric sign-in | ✅ | `expo-local-authentication`; `USE_BIOMETRIC`/`USE_FINGERPRINT` in manifest → Keystore |
| Offline sync (SQLite + drizzle) | ✅ | Hermes-safe BLOB path in `src/lib/research/vector-store.ts` (raw expo-sqlite, no Buffer) |
| Background sync | ✅ | `expo-background-task` → WorkManager on Android (`outbox-task.ts`) |
| Camera / image picker / video | ✅ | `expo-image-picker` |
| Audio record / playback | ✅ | `expo-audio` |
| File system / staging | ✅ | `expo-file-system/legacy` |
| On-device AI (llama.rn) | 🟡 | `llama.rn@0.12.4` autolinks for Android (jniLibs verified). Works, but **RAM-bound on the 2 GB AVD** — see §7 |
| Theming / status bar / safe area | ✅ | `theme.ts` already platform-selects fonts + `BottomTabInset` (ios 50 / android 80) |
| Keyboard "Done" button / accessory | ✅ | hidden on Android (system dismiss); `src/components/sirius.tsx` |
| Action sheets | ✅ | `Alert.alert` fallback where iOS uses `ActionSheetIOS` (`omni-tray.tsx`) |
| Voice transcription | 🟡 | Apple SpeechAnalyzer (`transcribe.ios.ts`, `@react-native-ai/apple`) is iOS-only; Android uses `transcribe.ts` → **server-side Gemini** fallback (audio uploaded). Functional parity. |
| **In-app purchases (RevenueCat)** | 🔧 | Only `EXPO_PUBLIC_REVENUECAT_IOS_KEY` set → `PURCHASES_ENABLED=false` on Android, paywall hidden. **Wiring Android key this session** (§6) |
| Network base URL | 🔧 | Points at `https://sirius.local` (mDNS) — emulator can't resolve. **Fix in §5** |
| Cookie-jar hardening | ⛔ | `with-cookie-jar-hardening.js` is iOS-only (clears `HTTPCookieStorage`). Not needed on Android, but the stale-cookie wedge class of bug is a watch-item (see memory: mobile auth toxic/stale cookie) |
| Siri hands-free capture (App Intents) | ⛔ | `with-capture-intents.js` + Swift intents are iOS-only; the Settings "Siri" section is `Platform.OS`-gated off on Android. **Note:** the `siriusapp://capture?text=…` deep link itself *does* work on Android (handled in `+native-intent.ts`) — only the OS-level voice trigger is iOS-only |

**No Android-only regressions found.** Every `Platform.OS` fork has a defined Android
branch (verified across `composer.tsx`, `focus.tsx`, `llm.tsx`, `settings.tsx`,
`post/[slug]/edit.tsx`, `sirius.tsx`, sign-in/up/reset/forgot, `omni-tray.tsx`).

---

## 3. What "parity" means here (scope agreement)

- **In scope (true blockers / decided work):** network fix (§5), RevenueCat Android (§6),
  tooling/env setup (§4), and the emulator runbook (§8).
- **Out of scope / accepted iOS-only:** OS-level Siri voice capture and Apple
  on-device SpeechAnalyzer. Android already degrades these gracefully (server transcription;
  capture deep link still works). Building Android App Actions / Assistant shortcuts is a
  *separate* future effort — flag to owner if desired, do not assume.

---

## 4. Implementation plan — Phase A: tooling/env (no code)

1. Set SDK env for the session (and consider adding to shell profile):
   ```sh
   export ANDROID_SDK_ROOT="$ANDROID_HOME"   # ANDROID_HOME already = /opt/homebrew/share/android-commandlinetools
   ```
2. (Optional belt-and-suspenders) create `apps/mobile/android/local.properties`:
   ```
   sdk.dir=/opt/homebrew/share/android-commandlinetools
   ```
   `expo run:android` will create this if missing.
3. JDK: attempt the build with the default JDK 23 first. **Contingency only** if Gradle
   complains:
   ```sh
   brew install --cask temurin@17
   export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
   ```

## 4b. Implementation plan — Phase B: network fix (code)  **[DECIDED: 10.0.2.2 + http]**

Three small edits + a different run command. The emulator reaches the Mac's host loopback
at `10.0.2.2`, so the web dev server runs **without** portless (plain `next dev` on :3000)
and the app targets `http://10.0.2.2:3000`.

1. **`apps/mobile/.env`** — change line 7:
   ```diff
   - EXPO_PUBLIC_AUTH_BASE_URL=https://sirius.local
   + EXPO_PUBLIC_AUTH_BASE_URL=http://10.0.2.2:3000
   ```
   (Revert to `https://sirius.local` when switching back to iOS-sim dev.)

2. **`apps/web/next.config.js`** — add the emulator host to dev origins (line ~15):
   ```diff
   - allowedDevOrigins: [...DEV_HOSTS],
   + allowedDevOrigins: [...DEV_HOSTS, "10.0.2.2"],
   ```
   Safe to commit; only affects Next dev cross-origin screening.

3. **Root `.env`** — trust the emulator origin in better-auth (works because
   `AUTH_TRUSTED_ORIGINS` → `extraTrustedOrigins`, applied in dev *and* prod;
   `packages/auth/src/index.ts:17,46`):
   ```diff
   - AUTH_TRUSTED_ORIGINS=siriusapp://
   + AUTH_TRUSTED_ORIGINS=siriusapp://,http://10.0.2.2:3000
   ```
   Leave `BETTER_AUTH_URL` / `NEXT_PUBLIC_BETTER_AUTH_URL` as-is for this session, OR set
   both to `http://localhost:3000` (the standard PORTLESS=0 value). Do **not** point them at
   `10.0.2.2` (that host only resolves *inside* the emulator, not in a Mac browser).

**Why this works:** dev cookies aren't `Secure` (`useSecureCookies: isProduction`,
`index.ts:71`), so plain HTTP authenticates fine. The mobile client POSTs to
`http://10.0.2.2:3000/api/auth/*`; better-auth trusts that origin via the env var; the
expo() plugin's `siriusapp://` callback is already trusted.

**Run command (this is the key difference from `bun run dev`):**
```sh
# Terminal 1 — web on :3000, NO portless proxy:
bun --cwd=apps/web run dev:app
# Terminal 2 — worker (optional; only needed to process the ingest queue):
bun run worker:dev
```

## 4c. Implementation plan — Phase C: RevenueCat Android  **[DECIDED: wire now]**  **[NEEDS OWNER: Google Play public SDK key `goog_…`]**

1. **`apps/mobile/src/lib/purchases/config.ts`** — make the key + flag platform-aware:
   ```ts
   import { Platform } from "react-native";

   export const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";
   export const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";

   export const REVENUECAT_API_KEY =
     Platform.select({ ios: REVENUECAT_IOS_KEY, android: REVENUECAT_ANDROID_KEY }) ?? "";

   export const REVENUECAT_ENTITLEMENT_ID = "Sirius AI Pro";
   export const PURCHASES_ENABLED = REVENUECAT_API_KEY.length > 0;
   ```
2. Update consumers that read `REVENUECAT_IOS_KEY` to use `REVENUECAT_API_KEY`
   (grep `REVENUECAT_IOS_KEY` — chiefly the `Purchases.configure({ apiKey })` call in
   `src/app/_layout.tsx`).
3. **`apps/mobile/.env`** — add (value from owner):
   ```
   EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_xxxxxxxxxxxxxxxxxxxxxxxx
   ```
4. **`apps/mobile/eas.json`** — add `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` to the `preview`
   and `production` profile `env` blocks (alongside the existing iOS key).

**Caveat for emulator testing:** the paywall *UI* will render once the key is set, but
actual purchases require Google Play Billing (a Play-signed build + a Play account with the
product configured). On the dev client you can verify the paywall appears and entitlement
resolves to "free"; end-to-end purchase testing needs a Play internal-testing build. The
**server** remains the real enforcer of the weekly cap regardless.

---

## 5. The one blocker, stated plainly

`apps/mobile/.env:7` → `EXPO_PUBLIC_AUTH_BASE_URL=https://sirius.local`. The Android
emulator has no mDNS resolver for `.local` names and `localhost` inside the emulator is the
*emulator*, not the Mac. Result without the §4b fix: every API call and the auth bootstrap
fail with DNS/connection errors; offline mirror may render cached data but nothing syncs or
logs in. The §4b `10.0.2.2 + http` fix resolves this.

---

## 6. Open dependencies / questions for the owner

1. **[NEEDS OWNER] RevenueCat Android public SDK key (`goog_…`)** from the RevenueCat
   dashboard (Google Play app configuration). Without it, Phase C lands the code but the
   paywall stays hidden on Android (graceful, identical to today's iOS-key-missing path).
2. **Confirm** there's no desire to build Android App Actions / Assistant equivalents for
   Siri hands-free capture this round (currently accepted as iOS-only).

---

## 7. Known emulator limitations (set expectations before testing)

- **On-device AI:** likely OOMs on the 2 GB `penguin` AVD. To test it, raise RAM:
  ```sh
  # edit ~/.android/avd/penguin.avd/config.ini → hw.ramSize=6144  (then cold-boot)
  ```
  or create a fresh AVD with more RAM, or test on a physical Android device.
- **Voice transcription:** Android path uploads audio to the server (Gemini) — needs the
  worker running and network up; it will not use Apple SpeechAnalyzer.
- **Purchases:** paywall renders but real purchase flow needs a Play-signed build (§4c).
- **Siri capture tab/section:** intentionally absent on Android.

---

## 8. End-to-end verification runbook (emulator)

### 8.1 One-time / per-session setup
```sh
# 0. SDK env
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# 1. Apply the §4b edits (mobile .env, next.config.js, root .env). Apply §4c if testing purchases.

# 2. Boot the emulator (cold boot recommended after a RAM change)
emulator -avd penguin            # add -no-snapshot-load for a clean cold boot
adb wait-for-device              # blocks until the device is online
adb devices                      # expect: emulator-5554   device
```

### 8.2 Start the backend (Mac host)
```sh
# Terminal 1: web on :3000 WITHOUT portless (so 10.0.2.2:3000 maps to it)
bun --cwd=apps/web run dev:app
# Terminal 2 (optional, for queue processing / server transcription):
bun run worker:dev
```
Sanity check the emulator can see the host:
```sh
adb shell run-as dev.copt.sirius true 2>/dev/null   # app not installed yet → ignore
adb shell curl -s -o /dev/null -w "%{http_code}\n" http://10.0.2.2:3000   # expect 200/3xx (curl may be absent; the in-app call is the real test)
```

### 8.3 Build + install + launch the app
```sh
# From repo root. Runs prebuild-if-native-changed → verify:native-ai → expo run:android.
bun --cwd=apps/mobile android
# Fast JS-only restarts afterward: press 'a' in the Metro window, or:
adb shell am start -n dev.copt.sirius/.MainActivity
```
Watch logs:
```sh
adb logcat --pid=$(adb shell pidof -s dev.copt.sirius) 2>/dev/null
# or filter Metro/RN: adb logcat ReactNativeJS:V '*:S'
```

### 8.4 Smoke checklist (manual, in the app)
Run top-to-bottom; each line is pass/fail.

**Auth & shell**
- [ ] App launches to onboarding/help on first run, then to Capture tab.
- [ ] Sign in (or sign up). Dev verify/reset links are printed in the **web server logs**
      (`[auth] verify-email URL …`) — open them in a Mac browser to verify the account.
- [ ] After login the Account/settings tab shows the handle (session carries `handle`).
- [ ] All four tabs render: Capture (composer), Catalog (library), Explore (tree), Account (settings).
      Bottom tab inset looks right (Android 80px).

**Core ingest pipeline**
- [ ] Capture a **note** → appears in Queue → worker processes → shows as a post in Catalog.
- [ ] Capture an **image** (picker) → batched SIGHT post created.
- [ ] Submit a **URL** → FINDING post created.
- [ ] Offline: enable airplane mode in the emulator, capture a note → it queues locally
      (outbox) → re-enable network → it syncs.

**Sharing / deep links**
- [ ] Share text from Chrome (Android share sheet → Sirius) → lands on `/shareintent`.
- [ ] Deep link test:
      `adb shell am start -a android.intent.action.VIEW -d "siriusapp://capture?text=hello"`
      → opens Capture prefilled with "hello".
- [ ] Deep link test: `adb shell am start -a android.intent.action.VIEW -d "siriusapp://u/<handle>"`
      → opens that profile.

**Search / catalog / explore**
- [ ] Catalog search returns hits (FTS + similar badges) for an existing post.
- [ ] Explore (tree) renders the taxonomy outline; drill into a node shows its Index.

**Auth-gated content**
- [ ] Queue tab loads without "unauthorized" (live API call succeeds — validates the cookie
      flow over `10.0.2.2`). If it 401s, re-login; suspect the cookie wedge class of bug.

**Biometric / media**
- [ ] Enable biometric sign-in in Settings (emulator: enroll a fingerprint via
      `adb -e emu finger touch 1` after triggering the prompt).
- [ ] Audio: record a voice memo in the composer → it uploads → draft created (server transcription).

**Theming**
- [ ] Toggle system dark/light (emulator quick settings) → status bar + theme follow.

**On-device AI (only if AVD RAM raised to ≥6 GB)**
- [ ] `/llm` screen offers the model download; download completes; chat returns a response.
- [ ] (Skip on a 2 GB AVD — expected to OOM.)

**Purchases (only after §4c + a Play build; not on the dev client)**
- [ ] Paywall renders on Android; entitlement resolves to "free" without a key/purchase.

### 8.5 Teardown
```sh
adb -e emu kill            # stop the emulator
# revert apps/mobile/.env EXPO_PUBLIC_AUTH_BASE_URL back to https://sirius.local for iOS-sim dev
```

---

## 9. File-change summary (for the implementation PR)

| File | Change | Phase |
| --- | --- | --- |
| `apps/mobile/.env` | `EXPO_PUBLIC_AUTH_BASE_URL` → `http://10.0.2.2:3000`; add `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | B, C |
| `apps/web/next.config.js` | add `"10.0.2.2"` to `allowedDevOrigins` | B |
| `.env` (root) | add `http://10.0.2.2:3000` to `AUTH_TRUSTED_ORIGINS` | B |
| `apps/mobile/src/lib/purchases/config.ts` | platform-aware key + `PURCHASES_ENABLED` | C |
| `apps/mobile/src/app/_layout.tsx` (+ any other `REVENUECAT_IOS_KEY` reader) | use `REVENUECAT_API_KEY` | C |
| `apps/mobile/eas.json` | add `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` to preview + production | C |
| `apps/mobile/android/local.properties` | (optional) `sdk.dir=…` | A |

`.env` files are gitignored; `next.config.js`, `config.ts`, `_layout.tsx`, `eas.json` are
committed. Coordinate via Agent Mail before committing (repo runs a multi-agent swarm; never
`git add -A`).

---

## 11. Install a PRODUCTION-configured build on a real Android device

Goal: run the app on physical hardware with the **same settings iOS production uses**
(prod backend `https://lesswhelmed.com`, on-device AI on, both RevenueCat keys), installed
directly onto the device.

> **RULE (verified 2026-06-26): physical Android devices use PRODUCTION only — never
> `sirius.local`.** A stock (non-rooted) Android device cannot resolve the portless mDNS
> name: `adb shell ping sirius.local` → `unknown host`. `.local` names don't resolve through
> the app network stack and you can't edit `/system/etc/hosts` without root, so bundling the
> portless CA + a `network_security_config` (the "trust the local CA" approach) is moot —
> resolution fails before trust ever matters. (Many Wi-Fi APs also isolate phone↔Mac LAN
> traffic, blocking even the LAN IP.) To exercise a local Mac dev server from a phone you'd
> need a real-cert public tunnel (Cloudflare/ngrok/Tailscale Funnel); for everything else,
> point devices at `https://lesswhelmed.com`. The emulator uses `http://10.0.2.2:3000` (§4b).

### Why a dedicated profile
The `production` profile is `distribution: "store"` → it builds an **AAB** for the Play
Store, which you cannot sideload. The new **`production-device`** profile (eas.json)
`extends: "production"` (inheriting all prod env: `EXPO_PUBLIC_AUTH_BASE_URL=lesswhelmed.com`,
`EXPO_PUBLIC_ON_DEVICE_AI=true`, both RevenueCat keys, `channel: production`) but overrides
to `distribution: "internal"` + `android.buildType: "apk"` so EAS emits an installable APK.

> Cloud builds read env from **eas.json**, NOT `apps/mobile/.env` (which is gitignored and
> dev-only). That's why the Android RevenueCat key was added to the `production`/`preview`
> env blocks — `production-device` inherits it.

### Prerequisites (one-time)
1. **EAS auth.** `bunx eas-cli whoami`. If not logged in: `eas login`, or
   `export EXPO_TOKEN=<token>` (note: eas-cli reads `EXPO_TOKEN`, not the repo's
   `EXPO_ACCESS_TOKEN` — copy the value).
2. **Clean, committed git tree.** `cli.requireCommit: true` → EAS refuses to build unless the
   ENTIRE working tree is committed (it uploads `git archive` of HEAD). When a multi-agent
   swarm has the tree dirty with unrelated WIP you must not commit, build from an **isolated
   git worktree** that contains only the mobile changes — the swarm's working dir is untouched:
   ```sh
   # from repo root — create a clean worktree off main on a throwaway branch
   git worktree add ../sirius-android-build -b android-device-build HEAD
   # copy ONLY the mobile build changes into it
   cp apps/mobile/eas.json                       ../sirius-android-build/apps/mobile/eas.json
   cp apps/mobile/src/lib/purchases/config.ts    ../sirius-android-build/apps/mobile/src/lib/purchases/config.ts
   cp apps/mobile/src/lib/purchases/index.ts     ../sirius-android-build/apps/mobile/src/lib/purchases/index.ts
   cd ../sirius-android-build
   git add apps/mobile/eas.json apps/mobile/src/lib/purchases/config.ts apps/mobile/src/lib/purchases/index.ts
   git commit -m "android: platform-aware RevenueCat key + production-device APK profile"
   # build from here (cloud only needs git state + eas.json; no bun install required locally)
   ```
   (Cleanup when done: `cd - && git worktree remove ../sirius-android-build`.) If/when the
   swarm flushes and the main tree is clean, you can instead just commit the 3 paths there.
3. **Android keystore.** First Android build, EAS offers to generate + manage one — accept
   (it's stored on EAS and reused; keep it for any future Play release).
4. The cloud build auto-runs `verify:native-ai` via the `eas-build-post-install` hook, so the
   llama.rn JSI bridge is guaranteed baked in.

### Build (cloud, ~10–20 min — device NOT needed yet)
```sh
bunx eas-cli build --profile production-device --platform android
# (optional local pre-check first: bun --cwd apps/mobile run verify:native-ai)
```
EAS prints a build-details URL and a QR code when done.

### Install on the device
Enable on the phone: Settings → About → tap **Build number** 7× → Developer options →
**USB debugging** (for the adb route) and/or allow **install unknown apps** (for the
download route).

- **Easiest (no cable):** open the EAS build URL (or scan the QR) in Chrome on the phone →
  Download → tap the APK → allow install.
- **Over USB:** `bunx eas-cli build:run -p android --latest` (downloads + `adb install`s the
  latest build). Or download the `.apk` and `adb install -r <file>.apk`.

The device just needs normal internet — it talks to the public `https://lesswhelmed.com`,
so **no portless / 10.0.2.2 / adb reverse** is involved (that was emulator-dev only).

### Caveats on a sideloaded prod build
- **RevenueCat purchases:** the paywall renders and entitlement resolves to "free", but
  *completing* a purchase needs the app distributed through Play (Google Play Billing
  rejects non-Play-licensed installs) AND products/offerings configured in the RevenueCat
  dashboard. For real purchase testing, `eas submit -p android` to the Play **internal**
  testing track (uses `submit.production.android` in eas.json — needs
  `google-play-service-account.json`).
- **Signing:** the APK is signed with the EAS-managed dev keystore, not a Play-signed cert —
  fine for testing, expected to differ from a store build.
- **OTA:** this build is on `channel: production`; `eas update --branch production` JS pushes
  will reach it only if the native fingerprint matches.

### OUTCOME (2026-06-26) + the local-release fallback that actually worked
The EAS cloud build (`production-device`) **errored** in the "Configure expo-updates" phase
with an opaque "Unknown error" (build `6b82f53d…`; SDK 56; the failure log is web-only).
Build credits were also exhausted (pay-as-you-go). We pivoted to a **local release build**,
which succeeded and installed on a physical Galaxy Z Fold (SM-F936U) running the prod backend.

Recipe (free, ~2 min once native tasks are cached; signs with the template `debug.keystore`
→ fine for testing, NOT a store cert):
```sh
cd apps/mobile/android
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
env EXPO_PUBLIC_AUTH_BASE_URL=https://lesswhelmed.com \
    EXPO_PUBLIC_ON_DEVICE_AI=true ON_DEVICE_AI_ENABLED=true \
    EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_JHDRfhioxKspkGosJYRsGDiVMJP \
    EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_UiLlycOYEXnCXkWUIBdrcrRIeNc \
  ./gradlew :app:assembleRelease -x lint -x test \
    -x lintVitalRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease \
    -PreactNativeArchitectures=arm64-v8a --build-cache
# install on the physical device (find serial with `adb devices`)
adb -s <SERIAL> install -r -d app/build/outputs/apk/release/app-release.apk
adb -s <SERIAL> shell monkey -p dev.copt.sirius -c android.intent.category.LAUNCHER 1
```
- **lint-vital MUST be excluded** — `:react-native-enriched-markdown:lintVitalAnalyzeRelease`
  OOMs the Gradle daemon Metaspace (512m). `-x lint` alone does NOT cover the vital tasks.
- Env is passed inline; `@expo/env` loads `.env` with `override:false`, so the inline
  prod values win over the dev `apps/mobile/.env` (which holds `10.0.2.2` for the emulator).
- Foldable screenshots: stream capture gets corrupted by a "Multiple displays" warning —
  use `adb shell screencap -p /sdcard/x.png && adb pull /sdcard/x.png`.

### If you'd rather NOT have on-device AI / want a lighter build
Use the existing `preview` profile instead (`--profile preview --platform android`): same
prod URL + internal APK + both RC keys, but `EXPO_PUBLIC_ON_DEVICE_AI` is unset (feature
hidden). `production-device` is the full iOS-production parity option.

---

## 10. Notes for the next agent
- Don't `bun run dev` for Android testing — it boots the iOS Simulator + portless. Use the
  `dev:app` + `expo run:android` path in §8.
- The native `android/` dir is gitignored and regenerated by prebuild; never commit it.
- `verify:native-ai` runs before the Android build and asserts `llama.rn` jniLibs exist — if
  it fails, the postinstall artifact download was blocked (check `trustedDependencies`).
