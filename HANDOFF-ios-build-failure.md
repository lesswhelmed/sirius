# HANDOFF: EAS iOS production build fails in "Configure expo-updates" phase

**Owner question:** this blocks the App Store deploy goal. A fix subagent must NOT land
changes without (a) confirming root cause against the real EAS phase log and (b)
respecting the deliberate dependency pins documented below. Ask the human before bumping
any pinned dep or changing the llama.rn pairing.

## Symptom

`eas build --profile production --platform ios` (and the two 2026-06-11 `development`
builds) ERROR with:

> Unknown error. See logs of the **Configure expo-updates** build phase for more information.

- Failed prod build: `e0f6d945-1715-44ca-9c1b-13a2bb820dbc` (v1.0.0 build 3)
  Logs: https://expo.dev/accounts/minasaleeb/projects/sirius/builds/e0f6d945-1715-44ca-9c1b-13a2bb820dbc
- Failed dev builds: `188b77c6-…`, `aef535a4-…` (2026-06-11)
- **Last GREEN prod build:** `602aa322-9c95-4000-9aef-6956f4840407` (v1.0.0 build 2,
  2026-06-02). So this is a regression introduced between 2026-06-02 and now.

## Regression window (commits since the green build, touching mobile deps)

```
8e9a6e2 verified on-device drafting — generateObject workaround   <-- llama.rn era
6a220e0 wip: on-device LLM drafting — llama.rn dev client          <-- introduced llama.rn
b186a18 add expo-dev-client (EAS development profile)
3563e45 pin three to 0.181 + single-instance Metro resolver
d4be51f / d978918 embedding space (expo-gl, three), portless
```
The on-device LLM drafting work (`6a220e0`, `8e9a6e2`) introduced `llama.rn` and is the
strongest correlate.

## Concrete anomalies found locally (`npx expo-doctor`, 19/21 passed)

### 1. Duplicate native module `llama.rn` (PRIME SUSPECT)
```
Found duplicates for llama.rn:
  ├─ llama.rn@0.11.5  (node_modules/llama.rn)                                   # direct dep, apps/mobile/package.json (^0.11.5)
  └─ llama.rn@0.10.1  (node_modules/@react-native-ai/llama/node_modules/...)    # via @react-native-ai/llama@0.12.0 (wants ^0.10.1)
```
Two copies of one native module is a documented cause of "unexpected build errors".

**Constraint — do NOT blindly converge versions.** Memory note
`llama-rn-structured-output` records that grammar/structured-output enforcement is
*silently broken* on `llama.rn 0.11` + `@react-native-ai` provider `0.12`, and the working
recipe in `curate.ts` depends on a specific pairing. Any single `llama.rn` version forced
via override must keep that recipe working. Check the memory + `@repo/ingest-draft`
(`curate.ts`) before choosing a version.

### 2. SDK patch mismatches are DELIBERATE (probably NOT the bug)
`expo-doctor` flags 13 packages behind SDK 56 (incl. `expo 56.0.8` vs `~56.0.11`,
`expo-updates 56.0.17` vs `~56.0.19`). BUT root `package.json` `overrides` intentionally
pin several:
```json
"overrides": { "kysely":"0.28.17", "expo":"56.0.8", "expo-constants":"56.0.16",
               "expo-linking":"56.0.13", "react":"19.2.3", "react-dom":"19.2.3" }
```
`expo-updates` is NOT in the overrides, so it floats to `56.0.17` (likely held by the
`expo@56.0.8` pin). Only revisit these pins if the real EAS log explicitly points at an
expo-updates/version error — and ask the human first; the pins look intentional.

## Desired solution (in order)

1. **Get the real error first.** Read the "Configure expo-updates" phase log for build
   `e0f6d945…` on expo.dev (human is logged in; pull via browser or have them paste the
   failing lines). Do not proceed on hypothesis alone.
2. **If duplicate native module:** add a bun `override`/resolution forcing a single
   `llama.rn` version satisfying both the app and `@react-native-ai/llama@0.12.0`, chosen
   to preserve the `llama-rn-structured-output` memory recipe. Reinstall → `expo-doctor`
   duplicate check passes → rebuild.
3. **If expo-updates/fingerprint config error:** investigate
   `runtimeVersion.policy: "fingerprint"` + `updates.url`; touch version pins only with
   human sign-off.
4. **Verify:** `npx expo-doctor` clean on the two failing checks → re-run
   `eas build --profile production --platform ios` → must reach FINISHED.

## Verified-good (do not touch)

- Server URL wiring for prod (lesswhelmed.com) across eas.json `production`,
  `.env.production`, `AUTH_TRUSTED_ORIGINS=siriusapp://`. Confirmed correct.
- EAS credentials (dist cert + provisioning profiles for `dev.copt.sirius` + share
  extension) valid to 2027-06-01.
- Mobile `tsc --noEmit` passes.
