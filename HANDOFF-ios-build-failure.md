# HANDOFF: EAS iOS production build fails — fingerprint runtimeVersion mismatch

> **Update 2026-06-14 — the llama.rn duplication in §A is RESOLVED.** The stack is now
> pinned to a **single `llama.rn@0.12.4`** (root `overrides` + `apps/mobile` dep), so the
> nondeterministic config-plugin / entitlement diff from the duplicate copies is gone, and
> `apps/mobile/scripts/verify-native-ai.mjs` hard-asserts the single 0.12.4 install on every
> build. The §B `node_modules` drift (clean reinstall before building) and the durable
> `runtimeVersion.policy` concern below still stand. Re-run the EAS prod build to confirm the
> fingerprint now matches; treat §A's "dedupe llama.rn / pick a version" instructions as DONE.

**Owner question:** this blocks the App Store deploy goal. The real EAS log is now in hand
(below). Fix subagent: implement the bounded local fix, verify fingerprint determinism
**locally**, and STOP for human review before consuming another EAS build or making any
"do-not-touch" change listed at the bottom.

## The actual error (from the EAS "Configure expo-updates" phase log)

> **Runtime version mismatch:**
>
> - Runtime version calculated on local machine: `16c30d90e2b4cef21cd57ee2b708481c9aa8c029`
> - Runtime version calculated on EAS: `e74aa8002a8e734296457b6f10f207e0d07970c4`
>   … Differing fingerprint when using fingerprint runtime version policy.

So `runtimeVersion.policy: "fingerprint"` (app.json) computes a **different hash on the dev
machine than on EAS for the same committed code**, and EAS hard-fails the build because
OTA updates published locally would be incompatible with the build.

- Failed prod build: `e0f6d945-1715-44ca-9c1b-13a2bb820dbc` (v1.0.0 build 3)
- Last GREEN prod build: `602aa322-…` (v1.0.0 build 2, 2026-06-02) — predates the
  llama.rn / on-device-LLM work, hence the regression.

## The fingerprint diff (what differs local→EAS) and WHY

### A. iOS entitlements differ — caused by the DUPLICATE `llama.rn`

- local (`beforeSource`) `ios.entitlements`: `{ increased-memory-limit }`
- EAS (`afterSource`) `ios.entitlements`: `{ extended-virtual-addressing, increased-memory-limit }`

Confirmed: **both** installed `llama.rn` copies add both entitlements
(`llama.rn/lib/.../expo-plugin/withLlamaRN.js:30-31`). The project has TWO copies:

```
llama.rn@0.11.5  (node_modules/llama.rn)                                    # direct dep ^0.11.5  (app.plugin.js dated Jun 11)
llama.rn@0.10.1  (node_modules/@react-native-ai/llama/node_modules/...)     # via @react-native-ai/llama@0.12.0 (^0.10.1)  (dated Jun 10)
```

With a duplicate, config-plugin resolution is nondeterministic across environments → the
entitlement is added on EAS but not in the local fingerprint snapshot. Deduping to ONE
`llama.rn` makes plugin resolution deterministic → this part of the diff disappears.

### B. Native module dir hashes differ (reanimated, safe-area-context, screens, worklets)

All four under `../../node_modules`, reason `rncoreAutolinkingIos`, different content hash
local vs EAS. This is local `node_modules` drift / pollution — the everyday `bun run dev`
path runs `expo run:ios`, a LOCAL native build that writes artifacts into these packages;
EAS installs them clean from the lockfile. A clean reinstall before building removes the
drift.

## Desired solution (bounded; verify locally before burning an EAS build)

1. **Reproduce locally first.** `cd apps/mobile && npx expo config` — check whether
   `ios.entitlements` currently lists `extended-virtual-addressing`. Note the current local
   fingerprint for comparison if useful.
2. **Dedupe `llama.rn` to a single version** via a bun `override` in root `package.json`.
   ⚠️ **Version choice is sensitive — investigate, do not guess.** Memory note
   `llama-rn-structured-output` records grammar/structured-output is silently broken on
   `llama.rn 0.11` + `@react-native-ai` provider `0.12`, with a working-around recipe in
   `@repo/ingest-draft` `curate.ts`. Read that file + the memory and determine which single
   `llama.rn` version keeps the on-device drafting recipe working AND satisfies
   `@react-native-ai/llama@0.12.0` (`^0.10.1`) and the app's direct usage. **If the right
   version is not unambiguous, STOP and surface the choice to the human** — do not pick
   blindly.
3. **Clean reinstall:** `rm -rf node_modules && bun install` (do NOT run `expo run:ios`
   afterward — that would re-pollute the dirs in §B). Then `npx expo-doctor` — the
   "duplicate dependencies" check must pass.
4. **Verify determinism locally if possible** (e.g., recompute the fingerprint), then
   **STOP and report** the proposed change + llama.rn version decision for human sign-off
   before re-running the EAS build (builds cost money / are outward-facing).
5. After sign-off: `eas build --profile production --platform ios` (from `apps/mobile`) →
   must reach FINISHED with no runtime-version mismatch.

### Durable concern to RAISE (do not silently change)

Even after a clean tree, the _next_ `bun run dev` (`expo run:ios`) will re-pollute the RN
dirs, so a future `eas build` from that machine could mismatch again. Options to discuss
with the human (design decisions — **do not change unilaterally**): always build from a
clean `node_modules`, or reconsider `runtimeVersion.policy` (CLAUDE.md documents
`fingerprint` as intentional). Flag it; let the human decide.

## Do NOT touch without explicit human approval

- `runtimeVersion.policy: "fingerprint"` (app.json) — documented as intentional.
- The deliberate `overrides` pins in root `package.json` (`expo@56.0.8`, `react`, etc.).
- `app.json` entitlements / plugin list.

## Verified-good (unrelated to this failure)

- lesswhelmed.com prod wiring (eas.json `production`, `.env.production`,
  `AUTH_TRUSTED_ORIGINS=siriusapp://`). Confirmed correct.
- EAS credentials (dist cert + provisioning profiles for `dev.copt.sirius` + share
  extension) valid to 2027-06-01.
- Mobile `tsc --noEmit` passes.
