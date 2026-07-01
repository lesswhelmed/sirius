# Install a production Android build on a physical device (USB)

How to get a **production-configured** Sirius build onto a plugged-in Android phone. This
is the sideload/test path — for the Play Store, use `bun run mobile:submit:android`
(see [ANDROID-BUILD.md](./ANDROID-BUILD.md)).

> **The one fact that trips everyone up:** an EAS `production` build is an **`.aab`**
> (Play Store bundle). You **cannot `adb install` an `.aab`.** It must be converted to a
> **universal APK** with `bundletool` first.

## TL;DR

```sh
# 0. one-time deps
brew install bundletool            # needs a JRE (brew install openjdk)

# 1. build the production AAB (clean git tree required — requireCommit)
bun run mobile:build:android:ci    # EAS cloud, ~15–20 min, prints a build URL

# 2. plug in the phone (USB data mode), unlock, "Allow USB debugging"
adb devices -l                     # confirm it's listed

# 3. convert latest finished AAB → universal APK → install
bun run mobile:install:android

# 4. launch
adb shell monkey -p dev.copt.sirius -c android.intent.category.LAUNCHER 1
```

`mobile:install:android` runs
[`.claude/skills/android-device-deploy/scripts/install-android-prod.sh`](../../../.claude/skills/android-device-deploy/scripts/install-android-prod.sh),
which resolves the latest **FINISHED production** AAB from EAS, downloads it, runs
`bundletool build-apks --mode=universal`, extracts `universal.apk`, and `adb install -r`s
it. Options:

```sh
bun run mobile:install:android -- <aab-url-or-path>   # pin a specific build
ANDROID_SERIAL=RFCT80QEFJE bun run mobile:install:android   # target one of several devices
NO_INSTALL=1 bun run mobile:install:android           # just build the APK, don't install
```

## Ground truth

| Thing | Value |
| --- | --- |
| App id | `dev.copt.sirius` |
| EAS project | `@minasaleeb/sirius` (`c14faf73-b1f9-425e-b66b-974ac26b827c`) |
| `production` artifact | `.aab` — needs bundletool to sideload |
| `preview` artifact | `.apk` — **directly `adb install`-able** (shortcut if you don't need prod signing/env) |
| Prod server | `https://lesswhelmed.com` (wired in `eas.json` → `production.env.EXPO_PUBLIC_AUTH_BASE_URL`) |
| `versionCode` | auto-incremented by EAS (`appVersionSource: remote`) |
| Build precondition | `requireCommit: true` — **clean git tree or the build is refused** |

A production build runs **standalone** (no Metro) and talks to the live backend — unlike a
`debug`/dev-client APK, which needs `bun --cwd apps/mobile start` + `adb reverse tcp:8081 tcp:8081`.

## The manual equivalent (what the script does)

```sh
cd apps/mobile
bunx eas-cli build:list --platform android --limit 5 --non-interactive --json   # grab the .aab URL
curl -fL -o app.aab "<applicationArchiveUrl>"
bundletool build-apks --bundle=app.aab --output=app.apks --mode=universal --overwrite
unzip -o app.apks universal.apk
adb install -r universal.apk
```

`bundletool` signs the universal APK with `~/.android/debug.keystore` — that only affects
the sideload wrapper; the app inside is the real production build.

## Gotchas (learned the hard way)

- **`INSTALL_FAILED_UPDATE_INCOMPATIBLE` (signature mismatch).** The universal APK is
  debug-signed. A locally-run `expo run:android` debug build shares that keystore, so
  `install -r` upgrades cleanly. But any differently-signed `dev.copt.sirius` already on
  the device blocks the install → `adb uninstall dev.copt.sirius` first, **which wipes the
  app's local data + login.** Confirm before wiping.
- **Device disappears from `adb devices`.** Happens when the cable flips to charge-only,
  the screen locks, or the "Allow USB debugging?" prompt is dismissed. Reconnect in data
  mode, unlock, tap **Allow**, re-check `adb devices -l`, retry.
- **Dirty tree blocks a fresh build.** `requireCommit` counts *untracked* files as dirty.
  On this repo's shared multi-agent tree, don't commit/stash files you didn't create —
  resolve stray untracked files with the owner first.
- **Build overages.** This EAS account is past its included builds (pay-as-you-go). Reuse a
  finished AAB (`bun run mobile:install:android`, no rebuild) when a fresh one isn't needed.

## Related

- [ANDROID-BUILD.md](./ANDROID-BUILD.md) — Android cloud build + Play submit runbook, build-failure history
- Skill: `.claude/skills/android-device-deploy/` — the agent-facing version of this doc
- Memory: `android-eas-build-gotchas`, `android-fingerprint-masked-view`
