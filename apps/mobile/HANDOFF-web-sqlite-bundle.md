# HANDOFF: Fix mobile web-bundle failure — `expo-sqlite` `wa-sqlite.wasm` unresolved

## Symptom (observed live)

Running the mobile app (`bun --cwd apps/mobile ios`, Metro on :8081), the **iOS**
build + bundle succeed and the app runs fine. But Metro **fails to bundle the web
target** (`@expo/router-server/node/render.js`) with:

```
Metro error: Unable to resolve module ./wa-sqlite/wa-sqlite.wasm
from node_modules/expo-sqlite/web/worker.ts

None of these files exist:
  * node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm(.web.ts|.ts|...)
  * node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm
```

Import stack (why web pulls in expo-sqlite):

```
apps/mobile/src/app/_layout.tsx
 → @/lib/db/client            (apps/mobile/src/lib/db/client.ts)
 → expo-sqlite                (build/index.js → hooks → ExpoSQLite.web.js → web/SQLiteModule.ts → web/worker.ts)
 → import "./wa-sqlite/wa-sqlite.wasm"   ← unresolved
```

## What I already verified

- `expo-sqlite` version: **56.0.5**.
- `node_modules/expo-sqlite/web/wa-sqlite/` exists but is **missing the wa-sqlite
  runtime assets**: it has `AccessHandlePoolVFS.js`, `FacadeVFS.js`, `MemoryVFS.js`,
  `VFS.js`, `sqlite-api.js`, `sqlite-constants.js`, `types/` — but **NO
  `wa-sqlite.js` and NO `wa-sqlite.wasm`** (the two files `web/worker.ts` imports at
  its top: `import WaSQLiteFactory from './wa-sqlite/wa-sqlite'` and
  `import wasmModule from './wa-sqlite/wa-sqlite.wasm'`).
- `apps/mobile/app.json` declares a **`web`** platform (≈ line 34), so web IS a
  declared target.
- `apps/mobile/metro.config.js` already customizes the resolver (pins `three`, adds
  `sql` to `sourceExts`). Check whether `.wasm` is in `resolver.assetExts` (it is by
  default in Expo SDK, but confirm). Adding `.wasm` to assetExts alone will NOT fix
  this — the underlying files are absent.
- Package manager is **bun** (hoisted linker, `bun@1.3.14`). A partial/odd install
  is plausible.

## Context you need

- `@/lib/db/client` is the **offline-first local store** (expo-sqlite + drizzle),
  phase-1 text-only — see memory/`docs`. It is fundamentally a **native, on-device**
  concern (local SQLite on the phone). The mobile app's real runtime is iOS/Android
  with on-device AI (llama.rn) + three/expo-gl; **web is not a primary product
  surface** here. So the offline SQLite store has no reason to load on web.
- Do NOT touch the worker/DB category-taxonomy work in flight: leave
  `packages/db/**`, `apps/worker/**`, and `packages/ingest-draft/**` ALONE. This fix
  is **mobile/metro/expo-sqlite only**.

## Approach (use systematic-debugging — confirm root cause before fixing)

First decide the real question: **does this app actually need expo-sqlite to run on
web at all?** Investigate `apps/mobile/src/lib/db/client.ts` and how `_layout.tsx`
uses it. Then pick the fix that matches intent:

1. **Most likely correct — keep the offline store native-only.** Split
   `@/lib/db/client` (or its expo-sqlite usage) so the **web** build does not import
   the expo-sqlite web worker path: e.g. a `client.web.ts` stub / `Platform.OS`
   guard / conditional dynamic import, so web gets a no-op (or in-memory) store and
   never resolves `wa-sqlite.wasm`. This removes the broken dependency from the web
   graph entirely and is the lowest-risk fix that matches "web isn't the target."
2. **If web genuinely must run the SQLite store** — then the wa-sqlite assets are
   actually needed: figure out why `wa-sqlite.js`/`wa-sqlite.wasm` are missing from
   the installed `expo-sqlite@56.0.5` (bun hoist dropping the `.wasm`? a known
   expo-sqlite web packaging issue for this version? does it expect the standalone
   `wa-sqlite` npm package?), and make Metro resolve them (assetExts + ensure files
   present). Confirm before going down this path — it's more work and may not match
   product intent.

Prefer (1) unless you find evidence web is a supported runtime that must persist
data. Whatever you choose, explain the root cause in your report.

## Verify the fix

Re-bundle the **web** target and confirm the wa-sqlite error is gone:

```sh
cd apps/mobile
bunx expo export --platform web   # one-shot web bundle; should complete with no wa-sqlite error
```

(Or trigger a web bundle against the running Metro on :8081.) Also confirm you did
**not** regress the iOS bundle: `bunx expo export --platform ios` should still
succeed. Do not commit anything — report the diff and the verification output back.

```

```
