# HANDOFF — React Three Fiber `JSX.IntrinsicElements` typecheck break (pre-existing on `main`)

## Status

`bun run check-types` **fails on a clean `main`** (verified with all unrelated changes
stashed — this predates the 2026-06-21 mobile dependency-bump work and is unrelated to it).
**37 errors total**, ALL the same class, split across two apps:

```
error TS2339: Property 'mesh' does not exist on type 'JSX.IntrinsicElements'.
error TS2339: Property 'sphereGeometry' does not exist on type 'JSX.IntrinsicElements'.
error TS2339: Property 'meshBasicMaterial' does not exist on type 'JSX.IntrinsicElements'.
error TS2339: Property 'instancedMesh' / 'color' / 'ambientLight' ... (all R3F three-elements)
```

Affected files:
- **mobile**: `apps/mobile/src/components/explore/constellation-scene.tsx`, `apps/mobile/src/app/space.tsx`
- **web**: R3F components under `apps/web/app/(app)/space/` (17 of the 37 errors)

Every error is a Three element (`mesh`, `sphereGeometry`, `meshBasicMaterial`, `instancedMesh`,
`ambientLight`, `color`, …) not being recognized as a valid JSX intrinsic element. Standard
intrinsics are fine — only R3F's `ThreeElements` augmentation is missing.

## Goal

Make `bun run check-types` pass (0 errors) for **both** `mobile` and `web` by getting R3F's
`ThreeElements` to register into the JSX intrinsic-elements namespace that TS actually resolves.
Do **not** suppress with `// @ts-expect-error` / `any` / disabling `strict`. Do **not** touch the
`three` / `@types/three` pins (must stay ≤ 0.181 on mobile per CLAUDE.md + the expo-gl
constraint memory).

## Diagnosis already done (start here, don't re-derive)

Resolved versions: `@react-three/fiber@9.6.1`, `@types/react@19.2.15`, React 19, `three` 0.181
(mobile) / 0.182 (web).

How R3F v9 ships the augmentation — `node_modules/@react-three/fiber/dist/declarations/src/three-types.d.ts`:

```ts
declare module 'react'              { namespace JSX { interface IntrinsicElements extends ThreeElements {} } }
declare module 'react/jsx-runtime'  { namespace JSX { interface IntrinsicElements extends ThreeElements {} } }
declare module 'react/jsx-dev-runtime' { namespace JSX { interface IntrinsicElements extends ThreeElements {} } }
export {};
```

Key facts established:
1. `expo/tsconfig.base` sets `"jsx": "react-jsx"` → TS resolves intrinsic elements from
   **`react/jsx-runtime`**'s `JSX` namespace (React 19 removed the global `JSX` namespace).
2. R3F's `/native` entry (`native.d.ts`) DOES `export * from "./three-types.js"`, so the
   augmentation file is in the module graph for mobile.
3. `constellation-scene.tsx` imports the runtime as a **value** import
   (`import { Canvas, useFrame } from "@react-three/fiber/native"`) — so the augmentation is
   NOT erased (good), but the JSX errors persist anyway.
4. NOTE: `import type { ThreeEvent } from "@react-three/fiber"` (line 20) is **type-only and
   erased** — type-only imports do NOT load module augmentations. The shared
   `@repo/embedding-scene` SpaceScene is documented to use "type-only fiber imports" (see the
   header comment in `constellation-scene.tsx`), which is a prime suspect for the **web** side:
   if web's R3F components reach fiber only through type-only/`@repo/embedding-scene` paths, the
   `react/jsx-runtime` augmentation never enters web's program.

## Leading hypothesis & recommended fix

The augmentation targets `react/jsx-runtime`'s `JSX` namespace, but it is either (a) not in the
program for **web** (type-only import chain), or (b) being shadowed / not merged in **both**
apps. The robust, low-risk fix is an **explicit, side-effecting global type-augmentation shim**
per app that is guaranteed to be in the `include` set:

`apps/mobile/src/types/three-fiber.d.ts` and `apps/web/types/three-fiber.d.ts` (adjust path to
each app's tsconfig `include`):

```ts
// Force R3F's ThreeElements into the JSX intrinsic namespace TS resolves under jsx:react-jsx.
import "@react-three/fiber"; // side-effecting (NOT `import type`) so the augmentation loads
import type { ThreeElements } from "@react-three/fiber";

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
```

If that alone doesn't take, also augment `react` and `react/jsx-dev-runtime` the same way, and
confirm each app's `tsconfig.json` `include` actually globs the new `.d.ts` (mobile includes
`**/*.ts`; web extends Next's config — verify `next-env.d.ts`/include covers `types/`).

**Verify the hypothesis first** before writing the shim: in a failing file, hover/print the
resolved JSX source — e.g. temporarily add `import "@react-three/fiber/native"` at the very top
of `space.tsx` (web) and re-run `bunx tsc --noEmit` in `apps/web` to see if errors clear. That
tells you whether it's a "not loaded" problem (web) vs a "namespace mismatch" problem (mobile).

## How to verify done

```sh
# mobile
cd apps/mobile && bun run check-types        # expect 0 errors
# web
cd apps/web && bun run check-types            # expect 0 errors (runs `next typegen` first)
# whole repo
cd <repo-root> && bun run check-types         # expect all 14 packages green
# guard the native AI bridge wasn't disturbed
cd apps/mobile && bun run verify:native-ai    # expect all ✓
```

## Constraints / do-not-touch

- Keep `three` ≤ 0.181 (mobile) — do NOT bump `three` / `@types/three` (expo-gl + R3F
  constraint, see CLAUDE.md and the `expo-gl three constraints` memory).
- Don't disable `strict`, don't blanket-`any` the scenes, don't `@ts-ignore` each element.
- Don't modify `node_modules`.
- Per repo CLAUDE.md: this is a multi-agent tree — commit ONLY the specific files you add/change
  (the new `*.d.ts` shims + any tsconfig `include` tweak). Never `git add -A`.
