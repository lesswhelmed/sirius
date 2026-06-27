# Android cloud build + Play submit runbook

Single source of truth for shipping the **Sirius Android app** to Google Play via **EAS
Build** (cloud). Pairs with [`ANDROID-PARITY.md`](./ANDROID-PARITY.md) (local emulator
testing) and mirrors the iOS path (the `ios-app-store-deploy` skill). Pinned to what's in
the repo as of **2026-06-26**.

> **Run every `eas` command from `apps/mobile/`.** The EAS project id lives in
> `apps/mobile/app.json` (`extra.eas.projectId = c14faf73-b1f9-425e-b66b-974ac26b827c`);
> from the repo root `eas` errors with "EAS project not configured". The root one-liners
> (`bun run mobile:build:android`, `bun run mobile:submit:android`) already `cd` for you.

---

## 0. TL;DR — the happy path

```sh
# from repo root, clean + committed git tree (requireCommit: true)
bun run mobile:build:android      # → EAS production build, AAB, channel "production"
# wait for FINISHED, then:
bun run mobile:submit:android     # → uploads AAB to Play "internal" track
```

That's it **if** the four pitfalls in §4 are already satisfied. They are, in the current
tree — this doc exists so the next build succeeds first go.

---

## 1. The server URL — the thing people get wrong

The app talks to a backend for auth + APIs. Which URL is baked into the binary depends
**entirely on the EAS profile's `env` block**, NOT on `apps/mobile/.env`.

| Context | Auth base URL | Where it's set |
| --- | --- | --- |
| Local dev (Simulator) | `https://sirius.local` | `apps/mobile/.env` → `EXPO_PUBLIC_AUTH_BASE_URL` |
| Local dev (Android emulator) | `http://10.0.2.2:3000` | `apps/mobile/.env` (commented alt) |
| **EAS `preview` / `production`** | **`https://lesswhelmed.com`** | **`apps/mobile/eas.json` → `build.<profile>.env`** |

**Why `sirius.local` never leaks into a cloud build:** `apps/mobile/.env` is **gitignored**,
and `requireCommit: true` means EAS builds from the committed tree only — so `.env` is
never uploaded. The cloud build's env comes 100% from the `env` block of the chosen
`eas.json` profile. `sirius.local` is a portless mDNS name that only resolves on the dev
LAN anyway; a phone/Play build could never reach it.

**If you ever change the prod URL**, change it in *all* of these or auth silently breaks:
- `apps/mobile/eas.json` → `build.preview.env` **and** `build.production.env` →
  `EXPO_PUBLIC_AUTH_BASE_URL`
- `.env.production` → `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`,
  `EXPO_PUBLIC_AUTH_BASE_URL`
- `.env.production` → `AUTH_TRUSTED_ORIGINS` must contain `siriusapp://` (the prod server
  must trust the app's auth callback scheme; dev trusts it automatically via
  `packages/auth/src/index.ts`)

Leave `apps/mobile/.env`'s `sirius.local` alone — it is dev-only and unused by store builds.

The rest of the production env (also baked from `eas.json`): `EXPO_PUBLIC_ON_DEVICE_AI=true`,
`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_...`.

---

## 2. Ground truth (don't re-derive)

- **Package name:** `dev.copt.sirius` (`app.json` → `expo.android.package`).
- **Versioning:** `appVersionSource: remote` + `production.autoIncrement: true` → **EAS owns
  the `versionCode`**; never hand-bump it. `version` (1.0.0) is the user-facing name.
- **Channel / OTA:** EAS channel `production`; `runtimeVersion.policy: fingerprint` (updates
  only reach a build whose native fingerprint matches — see §4.1).
- **Artifacts:** `production` → **AAB** (Play store default, no `android.buildType`).
  `production-device` → **APK** (internal/sideload, `buildType: apk`).
- **Submit target:** `eas.json` → `submit.production.android.track = internal` — uploads to
  the Play **internal testing** track, not the public production track. Promote to
  production in the Play Console (or change `track`).
- **Play credentials:** `apps/mobile/google-play-service-account.json` (gitignored). Must be
  present locally for `eas submit`; the service account needs release access to the app in
  Play Console.
- **EAS android keystore:** managed by EAS (generated on first build). `eas credentials`
  to inspect. Don't lose it — it signs every update.

---

## 3. Step by step

### 3.1 Preflight (do this before consuming a build)
```sh
git status                       # MUST be clean — requireCommit: true refuses a dirty tree
bun run db:generate              # mobile typecheck transitively pulls @repo/*
bun --cwd apps/mobile run check-types
cd apps/mobile && bunx eas-cli build:list --platform android --limit 5   # reuse vs fresh?
```
`mobile:build:android` also runs `verify:native-ai` first (asserts the llama.rn JSI bridge
is wired) and fails early if not.

### 3.2 Build
```sh
bun run mobile:build:android     # eas build --profile production --platform android
```
Watch the printed build URL. If it **ERRORS**, open the logs, read the failing phase, fix
the root cause — see §4.

### 3.3 Submit (interactive-ish; needs the service-account key)
```sh
bun run mobile:submit:android    # eas submit --profile production --platform android
```
First-ever submit: the app record for `dev.copt.sirius` must already exist in Play Console
and the service account must have access; otherwise create the app + a first manual
release, then re-run. Lands in the **internal** track → promote in Play Console.

---

## 4. Pitfalls that fail the first build (all currently handled)

### 4.1 Runtime-version / fingerprint mismatch — "Configure expo-updates" phase ⚠️ FIXED
**Symptom:** Android build ERRORS in the **Configure expo-updates** phase with
`Runtime version calculated on local machine … not equal to … during build`, fingerprint
diff pointing at `@react-native-masked-view/masked-view` (`rncoreAutolinkingAndroid`).

**Cause:** masked-view (transitive dep of `expo-router`) is the only autolinked Android
package whose `android/build.gradle` **rewrites its own `AndroidManifest.xml` at
gradle-configure time** (strips the `package="..."` attr for AGP ≥ 7). EAS fingerprints a
pristine install (manifest keeps `package=`); a dev machine that has run `expo run:android`
has the stripped manifest → the two fingerprints diverge → OTA updates published locally
won't match the build.

**Fix (already in tree):** the manifest is listed in **`apps/mobile/.fingerprintignore`**, so
`@expo/fingerprint` excludes it on both local and EAS → identical hash regardless of local
gradle pollution. **Do not remove that line.** Verify any time with:
```sh
cd apps/mobile && bunx eas-cli fingerprint:compare --build-id <android-build-id>
```
It should report the fingerprints match. (Full diagnosis: git log for the
`.fingerprintignore` change; memory `android-fingerprint-masked-view`.)

### 4.2 Dirty git tree
`requireCommit: true` aborts the build if the working tree is dirty. Commit or stash first.
`ios/`/`android/` are gitignored and regenerated by `expo prebuild` — never commit them.

### 4.3 Missing Play service-account key
`bun run mobile:submit:android` needs `apps/mobile/google-play-service-account.json`
(gitignored). Absent → submit fails. It's present now; if a teammate clones fresh, they
must obtain it out-of-band.

### 4.4 Wrong artifact / track expectations
`production` is an **AAB** for the store; you can't sideload it directly — use
`production-device` (APK) for that. Submit lands in the **internal** track, not public
production.

---

## 5. Other Android EAS scripts (mirror iOS)

| Root script | EAS command |
| --- | --- |
| `mobile:build:android` | `eas build --profile production --platform android` (interactive) |
| `mobile:build:android:ci` | same + `--non-interactive` (CI / agent / unattended) |
| `mobile:submit:android` | `eas submit --profile production --platform android` |
| `mobile:build:preview:android` | `eas build --profile preview --platform android` |
| `mobile:build:dev:android` | `eas build --profile development --platform android` |
| `mobile:build:all` | `eas build --profile production --platform all` (iOS + Android) |

OTA JS-only push (no native change, fingerprint must match): `bun --cwd apps/mobile update:prod`.

## 6. Operational notes (from the first live prod run, 2026-06-27)

- **EAS build credits:** the monthly included Android build credits are exhausted — further
  builds run **pay-as-you-go**. Expect a billing prompt; not an error.
- **First Play upload must be manual.** `eas submit` (track `internal`) only works after the
  app exists in the Play Console with at least one release uploaded **by hand** for
  `dev.copt.sirius`. Do that once, then API submits succeed.
- **Transient upload failures** (`write EPIPE` mid tarball upload) are network drops, not
  config — just re-run `mobile:build:android`. Keystore/credentials/fingerprint persist.
