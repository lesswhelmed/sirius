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

### Acceptance criteria (work item 1)

- **AC1.1** `constellation-scene.tsx` consumes `useReducedMotion()` from
  `src/lib/a11y.ts` (evidence: import + hook call at cited lines).
- **AC1.2** With reduce-motion ON, no ambient per-frame mutation runs: every
  `useFrame` loop either early-returns or computes the settled state; idle camera
  drift is disabled; tap-to-focus sets the camera position instantly instead of
  tweening. Evidence: per-loop citation of the guard.
- **AC1.3** Sweep is exhaustive and enumerated: the implementing agent reports
  EVERY match for `useFrame`, `Animated.loop`, `withRepeat`, and
  looping/ambient `withSpring`/`withTiming` in `apps/mobile/src`, with a per-site
  disposition — `guarded` (with line citation) or `exempt: one-shot functional
  transition` (with one-line justification). An unlisted match = AC failed.
- **AC1.4** `turbo check-types --filter=mobile --force` and
  `turbo lint --filter=mobile --force` pass; output pasted, not summarized.
- **AC1.5** *(user-manual, blocks the ASC claim, not the merge)* The Reduced
  Motion verification script in `docs/accessibility.md` passes on device,
  confirmed by the user.

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

### Acceptance criteria (work item 2, per surface)

- **AC2.1** Zero unlabeled interactive elements in the swept files. Evidence: the
  implementing agent returns an **element inventory table** — every `Pressable`,
  `TouchableOpacity`, `Switch`, `TextInput`, and tappable link in the surface,
  with its line number, `accessibilityRole`, and `accessibilityLabel` (or the
  reason it needs none, e.g. wrapped in an accessible parent). An interactive
  element absent from the table = AC failed.
- **AC2.2** Repeated list rows (feed cards, tree outline rows, settings rows)
  are single accessible units with a composed label; evidence: the composed
  label template per row type.
- **AC2.3** Decorative icons/images are hidden from VoiceOver; meaningful images
  are labeled. Evidence: enumerated icon dispositions.
- **AC2.4** Stateful controls carry `accessibilityState`; evidence per control.
- **AC2.5** `turbo check-types --filter=mobile --force` and
  `turbo lint --filter=mobile --force` pass; output pasted, not summarized.
- **AC2.6** *(user-manual, blocks the ASC claim, not the merge)* The VoiceOver
  core-loop script in `docs/accessibility.md` passes on device, confirmed by the
  user.

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

### Acceptance criteria (work item 3)

- **AC3.1** `docs/accessibility.md` exists with all four label sections, each
  containing the three required subsections (implementation + file pointers,
  exact ASC answer, on-device verification script), plus the accessibility
  contract and phase-2 backlog sections.
- **AC3.2** Every factual claim in the doc has a file pointer, and an
  **independent verifier subagent** (not the author) confirms each pointer
  exists and the code does what the doc claims. Any claim the verifier cannot
  confirm is removed or rewritten — the doc must never overstate.
- **AC3.3** Verification scripts are executable by a non-engineer: exact
  Settings paths, exact in-app steps, expected behavior, and the specific
  feedback points to report back.
- **AC3.4** The ASC answers section only claims what AC1.x/AC2.x evidence
  supports; anything pending user device verification is explicitly marked
  "do not select in ASC until verified on device."

## Verification & subagent execution rules (binding)

Every implementation/verification subagent dispatched for this work is given
these rules verbatim in its prompt, and its report is rejected (work re-run) if
it violates them:

1. **Run it or say you didn't.** Never claim a check passed without executing
   it in this run. Paste the actual command and its tail output. "Should pass"
   / "no reason it would fail" = a failed report.
2. **Force-bust the turbo cache.** All `check-types`/`lint` gates use
   `--force`. A `FULL TURBO` cached pass is not evidence (known false-pass
   trap in this repo).
3. **No fabricated device results.** Subagents cannot run VoiceOver or Reduce
   Motion on hardware. Device-level ACs (AC1.5, AC2.6) are ALWAYS reported as
   `pending user verification` — never `passed`.
4. **Evidence per AC.** Reports are structured as one line per AC:
   `AC id — pass/fail/pending — evidence (file:line citations, command output,
   or inventory table)`. Missing evidence = fail, not pass.
5. **Report failures verbatim.** If a gate fails or an AC can't be met, report
   the exact error and stop; do not work around it by changing the approach
   (per team rule: ask before deviating).
6. **Scope discipline.** Touch only the assigned files; no drive-by refactors;
   never run `git add`/`git commit` (the main session commits explicit paths
   only — swarm-shared tree).
7. **Author ≠ verifier.** The doc-claims verification pass (AC3.2) and the
   final AC roll-up are performed by subagents that did not write the code/doc
   they're checking.

The main session's final roll-up presents the full AC table (all of AC1–AC3)
with per-AC status before anything is declared done; ACs marked `pending user
verification` stay open until the user reports device results.

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
