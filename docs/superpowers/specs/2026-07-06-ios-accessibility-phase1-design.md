# iOS Accessibility — Phase 1 Design

**Date:** 2026-07-06
**Status:** Approved (design), pending implementation
**Scope:** `apps/mobile` only. Web app is out of scope.

## Goal

Make the Sirius iOS app honestly claimable under Apple's **Accessibility Nutrition
Labels** in App Store Connect for four features — VoiceOver, Reduced Motion, Dark
Interface, Sufficient Contrast — and produce the documentation that backs those
claims (evidence + the exact ASC answers + on-device verification scripts). This
doubles as due-diligence material for the sale.

Phase 1 deliberately starts small: two of the four labels (Dark Interface,
Sufficient Contrast) are already true and only need documenting; the other two
(Reduced Motion, VoiceOver) need targeted implementation work, not a rewrite.

## Current state (from the 2026-07-06 audit)

- **VoiceOver:** ~47 files have some a11y props. Strong: `composer.tsx` (61),
  shared primitives `src/components/sirius.tsx` (38), `explore/map-view.tsx` (20).
  Thin: `feed.tsx` (0 direct), `settings.tsx` (5), `tree.tsx` (11),
  `post/[slug]/index.tsx` (11). Tab bar is native (`NativeTabs.Trigger`) and
  accessible for free.
- **Reduced Motion:** `src/lib/a11y.ts` exports `useReducedMotion()` +
  `announcePolite()`, but only `ProgressRow` in `sirius.tsx` consumes it. The 3D
  Explore scene `src/components/explore/constellation-scene.tsx` runs four
  `useFrame` loops (camera drift, node animation) unguarded.
- **Dark Interface:** dual light/dark theme, single source `theme.ts`, contract in
  `apps/mobile/docs/THEMING.md`. Already true.
- **Sufficient Contrast:** WCAG-AA verified per THEMING.md's accessibility
  contract. Already true.
- **Dynamic Type:** no font-size token scale, no `maxFontSizeMultiplier`, untested
  at accessibility sizes. **Deferred to phase 2** — do not claim Larger Text.

## Work item 1: Reduced Motion

**File:** `src/components/explore/constellation-scene.tsx`

- Consume `useReducedMotion()` from `src/lib/a11y.ts`.
- When reduce-motion is ON:
  - Nodes render at their rest/settled positions — no continuous per-frame node
    animation.
  - No idle camera drift.
  - Tap-to-focus still works, but the camera moves instantly (snap, no animated
    tween).
- When OFF: behavior unchanged.

**Sweep:** grep `apps/mobile/src` for other continuous/looping animations
(`useFrame`, `Animated.loop`, reanimated `withRepeat`/`withSpring` driving
ambient motion) and guard any ambient/decorative ones behind the same hook.
One-shot functional transitions (e.g. a sheet sliding in) do not need guarding —
Apple's bar is reducing *unnecessary/vestibular-triggering* motion, not freezing
the UI.

## Work item 2: VoiceOver baseline

Bring these surfaces up to the composer's labeling standard:

1. `src/app/(tabs)/feed.tsx` + the shared components it renders
2. `src/app/(tabs)/settings.tsx`
3. `src/app/(tabs)/tree.tsx`
4. `src/app/post/[slug]/index.tsx`

The standard, per surface:

- Every interactive element (`Pressable`, `TouchableOpacity`, `Switch`, links) has
  `accessibilityRole` + `accessibilityLabel` (+ `accessibilityHint` only where the
  action isn't obvious from the label; hints are read after a pause, so don't
  over-hint).
- Stateful controls carry `accessibilityState` (`selected`, `disabled`,
  `expanded`, `checked`).
- Decorative icons/images are hidden from the screen reader
  (`accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"`
  or simply not focusable); meaningful images get labels.
- List rows (feed cards, tree outline rows, settings rows) read as **one unit**:
  the row container is `accessible={true}` with a composed label (e.g.
  "Post title, by handle, shared with Friends"), instead of VoiceOver stepping
  through 4 text fragments per card.
- Dynamic feedback (submit success, load states) uses `announcePolite()` where a
  sighted user gets visual-only feedback — only where clearly missing; don't
  spray announcements.

**Primitive addition (only if a pattern repeats):** if the sweeps find the same
icon-only-pressable pattern unlabeled in 3+ places, add one small labeled
icon-button primitive to `sirius.tsx` and use it in the swept screens. Do not
refactor existing well-labeled surfaces onto it.

**Execution:** four parallel subagent sweeps (one per surface), each gated on
`turbo check-types` + `lint` (with `--force` per the turbo-cache false-pass rule).

## Work item 3: Documentation — `docs/accessibility.md`

One doc, four per-label sections (VoiceOver, Reduced Motion, Dark Interface,
Sufficient Contrast), each containing:

1. **What's implemented** — behavior description + maintained file pointers.
2. **App Store Connect answer** — the exact selection to make in the Accessibility
   Nutrition Label form for this feature, including which ASC sub-questions apply.
3. **On-device verification script** — exact manual steps for the user (Settings →
   Accessibility toggles, what to do in the app, what correct behavior looks
   like, specific feedback points to report). No simulator automation — per team
   preference, verification is user-manual.

Plus two closing sections:

- **Accessibility contract** (modeled on THEMING.md's contrast contract): the
  invariants every new surface must uphold — every interactive element labeled +
  role'd, rows read as one unit, decorative elements hidden, ambient motion
  guarded by `useReducedMotion()`, contrast per THEMING.md.
- **Phase 2 backlog:** Dynamic Type (font-size token scale +
  `maxFontSizeMultiplier` clamps + large-size testing → claim Larger Text),
  Voice Control verification pass, `eslint-plugin-react-native-a11y` enforcement,
  Differentiate Without Color Alone audit.

## Explicitly out of scope (phase 1)

- Dynamic Type / Larger Text claim
- Voice Control claim
- Web app (`apps/web`) accessibility
- ESLint a11y enforcement tooling
- Captions/audio descriptions (no media requiring them)

## Success criteria

1. Reduce Motion ON ⇒ Explore scene is static-but-functional; no ambient motion
   anywhere in the app.
2. VoiceOver user can complete the core loop — capture a note, check the queue,
   read a post in the feed/library, open a post detail, change a post's audience,
   navigate settings — with every stop announced sensibly.
3. `docs/accessibility.md` exists with all four labels' evidence, ASC answers, and
   verification scripts; user has run the scripts on device and confirmed.
4. `turbo check-types` + `lint` pass (`--force`d) with zero new warnings.
