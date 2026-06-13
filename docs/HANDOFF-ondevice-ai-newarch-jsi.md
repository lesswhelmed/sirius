# HANDOFF — On-device AI "missing engine" under the New Architecture

**Date:** 2026-06-13
**Status:** Root cause confirmed. No code changed yet (owner asked for a handoff only).
**Area:** `apps/mobile` on-device LLM (`llama.rn` JSI bridge)

---

## TL;DR

On-device AI shows **"On-device AI unavailable / This build is missing the on-device
AI engine"** on the iOS Simulator. This is **not** the stale-binary case the error copy
and `[[llama-rn-jsi-stale-binary]]` describe. It is a **half-applied `llama.rn` upgrade
(0.10.1/0.11.5 → 0.12.4)** left in an inconsistent state:

- Deps + overrides now resolve **`llama.rn@0.12.4`** (New-Architecture-capable).
- The **running simulator binary was compiled against the old `llama.rn`** (legacy-bridge
  `install()` that returns `false` under bridgeless New Arch → `"JSI bindings not installed"`).
- `scripts/verify-native-ai.mjs` and `engine.ts` comments still hardcode/reference **`0.10.1`**,
  so the build-time gate is now internally inconsistent with the resolved version.

**The fix is almost certainly: finish the upgrade — align the version pins/gate, then rebuild
native against 0.12.4 and verify.** It was NOT verified end-to-end yet (see Open Questions).

> ⚠️ Correction of an earlier wrong conclusion made in-session: I initially said "no rebuild
> can fix this — it's a fundamental New-Arch incompatibility." That was based on reading
> `llama.rn@0.10.1` source **while node_modules was mid-flux**. The now-resolved `0.12.4`
> **does** support the New Architecture. Disregard the "disable New Arch" framing as the
> primary path.

---

## Symptom

`apps/mobile` → On-device AI screen (`/llm`) renders `MISSING_NATIVE_BRIDGE_MESSAGE`
(`apps/mobile/src/lib/llm/engine.ts:37`). Reproduced on the booted iPhone 17 Pro sim
(udid `08F63C27-CC61-4938-BB98-E4DDC14F668C`).

Snapshot text observed:
```
LOCAL MODEL
On-device AI unavailable
This build is missing the on-device AI engine. Reinstall or update the app — reloading
won't fix it. (Dev: rebuild the native app, e.g. `expo run:ios`; a Metro reload keeps the old binary.)
```

## The failure chain (confirmed)

1. App runs **New Architecture / bridgeless**: `ios/Sirius/Info.plist` → `RCTNewArchEnabled = true`
   (RN **0.85.3**, Expo SDK 56 default; `app.json` does not set `newArchEnabled`).
2. `engine.ts:65` calls `installJsi()` from `llama.rn` up front (`checkNativeBridge()`).
3. `llama.rn/src/index.ts:156-162` `installJsi()` calls native `RNLlama.install()`; if it
   resolves `false` and `global.llamaInitContext` is unset → throws `"JSI bindings not installed"`.
4. The **old** `RNLlama.mm` `install()` (0.10.1) used legacy-bridge only:
   `RCTBridge *bridge = [RCTBridge currentBridge]; if (!cxxBridge.runtime) { resolve(@false); }`.
   Under bridgeless there is no `RCTCxxBridge.runtime` → returns `false` → throws.
5. `isMissingBridgeError()` (`engine.ts:40`) matches `"JSI bindings"` → friendly message shown.

## Why a rebuild "didn't fix it" this session

I ran `bun --cwd apps/mobile ios` (`expo run:ios`) and got a fresh binary (installed
`14:12`), but it was compiled **against the old `llama.rn`** (node_modules flipped to
`0.12.4` only after / around that build, and DerivedData is incremental). So the binary
still had the legacy-bridge `install()`. A clean rebuild against `0.12.4` was not done.

## What is actually installed now (authoritative)

- `node_modules/llama.rn` = **0.12.4** (single copy; matches `bun.lock` lines 287/2106 and root `overrides`).
- **0.12.4 supports the New Architecture** — confirmed in `node_modules/llama.rn/ios/`:
  - `RNLlama.h:3` imports `<ReactCommon/RCTTurboModule.h>`.
  - `RNLlama.mm:17,128-132` `#ifdef RCT_NEW_ARCH_ENABLED` + `getTurboModule` returning `NativeRNLlamaSpecJSI`.
  - `RNLlama.mm:90-118` hardened `install()`: `self.bridge ?: [RCTBridge currentBridge]`, handles
    `bridge.batchedBridge`, `cxxBridge.jsCallInvoker ?: bridge.jsCallInvoker`.

## Working-tree inconsistencies (the actual bug to close)

`git status` shows an in-progress upgrade. `git diff`:
- `apps/mobile/package.json`: `"llama.rn": "^0.11.5"` → **`"^0.12.4"`**
- root `package.json` overrides: `"llama.rn": "0.10.1"` → **`"0.12.4"`**, plus a new
  `trustedDependencies` note: *0.12.4 fetches its native artifacts (rnllama xcframework /
  Android libs) via a postinstall (`install/download-native-artifacts.js`); bun blocks
  postinstalls by default → must stay trusted or every install (local AND EAS) ships with
  no native llama.*
- **`apps/mobile/scripts/verify-native-ai.mjs:27`** still hardcodes `EXPECTED_LLAMA_RN = "0.10.1"`.
  With `0.12.4` resolved, this gate now **fails** (`0.12.4 !== 0.10.1`) — or passes only against
  a stale `node_modules`. Its comment ("@react-native-ai/llama@0.12's peer range is ^0.10.1")
  is also out of date.
- `engine.ts:13-20,36` comments still narrate the `0.10.1` JSI story.
- `@react-native-ai/llama@0.12.0` peerDependency is `llama.rn: "^0.10.1"` (`bun.lock:816`),
  which does **not** semver-allow `0.12.4` — it's satisfied only because the root `override`
  forces it. Confirm no runtime break from this peer mismatch.

---

## Recommended fix (for the implementing subagent)

1. **Settle deps:** `bun install` and confirm `require('llama.rn/package.json').version === '0.12.4'`
   and that the `download-native-artifacts` postinstall ran (xcframework present in
   `node_modules/llama.rn/ios/rnllama.xcframework`).
2. **Fix the gate:** in `apps/mobile/scripts/verify-native-ai.mjs` set `EXPECTED_LLAMA_RN = "0.12.4"`
   and update the stale comment. Run `bun --cwd apps/mobile run verify:native-ai` → must pass.
3. **Update `engine.ts` comments** referencing `0.10.1` to `0.12.4` (no logic change expected;
   `installJsi`/`checkNativeBridge` API is unchanged across the bump — verify).
4. **Clean native rebuild against 0.12.4:** `bun --cwd apps/mobile dev`
   (`expo prebuild --clean && verify:native-ai && expo run:ios`) — the `--clean` matters so
   DerivedData/Pods don't reuse old `llama.rn` objects. (Plain `bun --cwd apps/mobile ios`
   may reuse stale build artifacts.)
5. **Verify the bridge installs:** open `/llm`; `checkNativeBridge()` must return `{ok:true}`
   (no "missing engine" copy). Then download a model and run one generation.
6. **Reconcile the peer mismatch** (`@react-native-ai/llama@0.12.0` wants `llama.rn ^0.10.1`):
   check for a newer `@react-native-ai/llama` that targets `0.12.x`, or confirm the override is safe.
7. **Test on a physical device too** (Metal is force-disabled on the simulator —
   `RNLlama.mm` `getMetalAvailability` `#if TARGET_OS_SIMULATOR supportsMetal=false`; sim uses CPU,
   so device behavior/perf differs). See `docs/HANDOFF-on-device-ai.md` for the device runbook.
8. **Update docs/memory:** the "rebuild fixes it" story in the error copy and
   `[[llama-rn-jsi-stale-binary]]` is misleading for a *version-skew* failure — note that an
   incomplete `llama.rn` major bump (binary built against old, deps on new) presents identically.

## Open questions / risks

- **Unverified:** that `0.12.4`'s `install()` returns `true` under *full* bridgeless at runtime.
  It is clearly New-Arch-designed (TurboModule), but it still reads `cxxBridge.runtime`; confirm
  empirically after the clean rebuild (step 5). If it still returns `false`, escalate — that
  would be a genuine bridgeless gap needing a patch or an upstream issue.
- Why did `node_modules/llama.rn` change from `0.10.1` → `0.12.4` mid-session? Likely a
  `bun install` settling the modified `package.json`/lock. Make sure the tree is in a single,
  committed, consistent state before building.

## Quick repro / inspection commands

```sh
# what's actually installed
node -e "console.log(require('llama.rn/package.json').version)"            # expect 0.12.4
/usr/libexec/PlistBuddy -c "Print :RCTNewArchEnabled" apps/mobile/ios/Sirius/Info.plist  # true
grep -n "EXPECTED_LLAMA_RN" apps/mobile/scripts/verify-native-ai.mjs       # currently 0.10.1 (stale)
sed -n '90,118p' node_modules/llama.rn/ios/RNLlama.mm                      # New-Arch install()

# rebuild + verify (the fix)
bun --cwd apps/mobile dev
# then on the booted sim, open /llm and confirm no "missing engine" copy:
agent-device --session s16 open "dev.copt.sirius://llm"; agent-device --session s16 open dev.copt.sirius
```
