// Register React Three Fiber's `ThreeElements` into the JSX intrinsic-elements
// namespace that TypeScript resolves under React 19 (`react/jsx-runtime`).
//
// Why this shim is needed: R3F v9 ships its `IntrinsicElements extends
// ThreeElements` augmentation in `@react-three/fiber/dist/.../three-types.d.ts`,
// but that augmentation only enters the program when fiber is imported as a
// *value* (side-effecting). The web Observatory renders the shared
// `@repo/embedding-scene` scene (`space-scene.tsx`), which reaches fiber only
// through `import type { ThreeEvent } from "@react-three/fiber"` — type-only and
// therefore erased, so the augmentation never loads and every Three element
// (`mesh`, `group`, `ambientLight`, ...) reports TS2339. This file forces the
// augmentation in via a side-effecting import and re-declares the merge so it is
// guaranteed to be present program-wide. Do NOT change this to `import type`.
//
// The three `IntrinsicElements extends ThreeElements {}` blocks below MUST stay
// empty interfaces: only interface declaration-merging widens React's existing
// `JSX.IntrinsicElements` (a `type` alias wouldn't merge), so the
// `no-empty-object-type` rule is disabled file-wide rather than refactored.
/* eslint-disable @typescript-eslint/no-empty-object-type -- merging into JSX.IntrinsicElements requires an empty `interface … extends` */
import "@react-three/fiber";
import type { ThreeElements } from "@react-three/fiber";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare module "react/jsx-dev-runtime" {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
