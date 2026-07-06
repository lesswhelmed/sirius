# iOS Accessibility Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four App Store Accessibility Nutrition Label claims (VoiceOver, Reduced Motion, Dark Interface, Sufficient Contrast) honestly true in `apps/mobile`, and produce `docs/accessibility.md` with evidence, exact ASC answers, and on-device verification scripts.

**Architecture:** Three thin layers — (1) reduce-motion guards threaded through the two R3F camera/halo animation files via the existing `useReducedMotion()` hook, (2) targeted VoiceOver label fixes (the audit found the screens mostly labeled; only enumerated gaps remain), (3) an evidence doc whose claims are verified by an independent subagent. Spec: `docs/superpowers/specs/2026-07-06-ios-accessibility-phase1-design.md`.

**Tech Stack:** React Native / Expo, `AccessibilityInfo` (via `src/lib/a11y.ts`), @react-three/fiber + expo-gl, bun + turbo.

## Global Constraints

- **No test runner exists in this repo.** Gates are `bunx turbo check-types --filter=mobile --force` and `bunx turbo lint --filter=mobile --force` (`--force` is mandatory — cached `FULL TURBO` passes are not evidence). Never claim "tests pass."
- **Binding subagent rules** (spec §"Verification & subagent execution rules") apply to every subagent verbatim: run-it-or-say-you-didn't with pasted output; `--force` all gates; device-level ACs always `pending user verification`; evidence per AC; failures verbatim + stop (ask before deviating); assigned files only; **no `git add`/`git commit` by subagents** (main session commits explicit paths only — swarm-shared tree); author ≠ verifier.
- **Agent-mail:** main session (MagentaChapel) reserves each task's paths via `file_reservation_paths` before dispatch and releases after commit. Do NOT touch `apps/mobile/src/app/(auth)/**` or auth-client config — DarkCanyon is fixing the autofill input-wipe there.
- Commits: `git commit -m "..." -- <explicit paths>` only. Never `git add -A`.
- expo-gl invariant: never skip `state.gl.render(...)` / `getContext().getError()` inside `useFrame` — the canvas freezes. Reduce motion = snap (damping 1), not stop rendering.
- All paths below are relative to `apps/mobile/` unless prefixed with `docs/` or `packages/`.

---

### Task 1: Reduce Motion guards (constellation scene + space screen)

**Files:**
- Modify: `src/components/explore/constellation-scene.tsx` (PulseHalo ~483-503, CameraRig ~606-660, ConstellationHero ~825)
- Modify: `src/app/space.tsx` (orbit useFrame ~79, `ORBIT_DAMPING` ~76)

**Interfaces:**
- Consumes: `useReducedMotion()` from `src/lib/a11y.ts` (returns live `boolean`; pattern precedent: `ProgressRow` in `src/components/sirius.tsx:256`).
- Produces: `PulseHalo` and `CameraRig` gain a required `reduced: boolean` prop. `docs/accessibility.md` (Task 5) will cite these lines.

Animation inventory this task must fully cover (from the 2026-07-06 sweep — AC1.3 requires re-verifying it's still exhaustive):

| Site | Type | Disposition |
|---|---|---|
| `constellation-scene.tsx:494` PulseHalo sin-pulse | AMBIENT (never settles) | still it |
| `constellation-scene.tsx:634` CameraRig DAMPING ease | camera fly-in (settles) | snap: damping → 1 |
| `constellation-scene.tsx:710` LabelProjector | reactive projection (settles) | no change (settles instantly once camera snaps) |
| `app/space.tsx:79` orbit ORBIT_DAMPING ease | camera ease (settles) | snap: damping → 1 |
| `sirius.tsx:968`, `sirius.tsx:779`, `collapsible.tsx:44`, `map-view.tsx:85` | ONE-SHOT functional transitions | exempt (spec: one-shot transitions stay) |
| `sirius.tsx` ProgressRow | already guarded | no change |

- [ ] **Step 1: Re-verify the sweep is exhaustive**

Run and record output (AC1.3 evidence — every match must appear in the disposition table above; add + disposition any new ones):

```bash
grep -rn "useFrame(" apps/mobile/src --include='*.tsx' --include='*.ts'
grep -rn "withRepeat\|Animated.loop" apps/mobile/src --include='*.tsx' --include='*.ts'
grep -rn "withTiming\|withSpring\|withSequence" apps/mobile/src --include='*.tsx' --include='*.ts'
```

- [ ] **Step 2: Guard PulseHalo**

In `constellation-scene.tsx`, add `reduced` to PulseHalo's props and still the pulse (static mid-range glow, no per-frame trig):

```tsx
function PulseHalo({ position, palette, reduced }: { position: Vec3; palette: Palette; reduced: boolean }) {
  const ref = useRef<Mesh>(null);
  const t = useRef(0);
  useFrame((_state, delta) => {
    const m = ref.current;
    if (!m) return;
    const mat = m.material as { opacity?: number };
    if (reduced) {
      m.scale.setScalar(1);
      if (mat) mat.opacity = 0.24;
      return;
    }
    t.current += delta;
    const s = 1 + 0.35 * (0.5 + 0.5 * Math.sin(t.current * 2.2));
    m.scale.setScalar(s);
    if (mat) mat.opacity = 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(t.current * 2.2));
  });
```

- [ ] **Step 3: Guard CameraRig (snap, don't stop)**

Add `reduced: boolean` to CameraRig's props. At the top of its `useFrame` callback compute the effective damping and use it for **all** eases in the loop — yaw, pitch, target xyz, radius, AND the sheet-lift `setViewOffset` ease (~line 657):

```tsx
useFrame((state) => {
  const d = reduced ? 1 : DAMPING; // reduce-motion: snap to target this frame
  const o = curOrbit.current;
  o.yaw += (orbit.current.yaw - o.yaw) * d;
  o.pitch += (orbit.current.pitch - o.pitch) * d;
  const c = curTarget.current;
  for (let i = 0; i < 3; i++) {
    c[i] += (target.current[i]! - c[i]!) * d;
  }
  curRadius.current += (fitRadius * zoom.current - curRadius.current) * d;
  // ... unchanged camera.position.set / lookAt ...
  // sheet-lift ease near line 657: replace its DAMPING factor with `d` too
  // ... unchanged: state.gl.render(state.scene, state.camera); getContext().getError();
}, 1);
```

This one change covers every fly-in path (double-tap, Frame button, auto-frame on open, selection change) because `frameNode` (line ~870) only sets target refs — CameraRig does all animating. Do NOT modify `frameNode`.

- [ ] **Step 4: Thread the hook from ConstellationHero**

In `ConstellationHero` (~825, outside the Canvas):

```tsx
import { useReducedMotion } from "@/lib/a11y";
// inside ConstellationHero:
const reduced = useReducedMotion();
// pass reduced={reduced} to <CameraRig .../> and <PulseHalo .../> at their render sites
```

- [ ] **Step 5: Guard space.tsx orbit**

In `src/app/space.tsx`, import `useReducedMotion` from `@/lib/a11y`, call it in the component owning the `useFrame` at ~79, and use `const d = reduced ? 1 : ORBIT_DAMPING;` in place of `ORBIT_DAMPING` inside the loop (render/flush lines unchanged).

- [ ] **Step 6: Gates (pasted output required)**

```bash
bunx turbo check-types --filter=mobile --force
bunx turbo lint --filter=mobile --force
```
Expected: both PASS, zero new warnings.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(a11y): reduce-motion guards — still PulseHalo, snap camera eases (AC1.1-1.3)" -- apps/mobile/src/components/explore/constellation-scene.tsx apps/mobile/src/app/space.tsx
```

---

### Task 2: TextLink explicit labels (shared primitive)

**Files:**
- Modify: `src/components/sirius.tsx` (TextLink, ~655-674 only — touch nothing else in this file)

**Interfaces:**
- Consumes: TextLink's existing `label: string` prop (all call sites pass visible text, some with glyphs: "People →", "Groups →", "Cancel").
- Produces: TextLink accepts optional `accessibilityLabel?: string`; when absent, the accessible name is `label` with decorative glyphs stripped. No call-site changes required anywhere.

- [ ] **Step 1: Read the current TextLink implementation** (`sirius.tsx:655-674`) to anchor the exact edit.

- [ ] **Step 2: Add the explicit label**

Add to TextLink's prop type: `accessibilityLabel?: string`. On its `<Pressable accessibilityRole="button">` add:

```tsx
accessibilityLabel={
  accessibilityLabel ?? label.replace(/[→←▸▹›‹✕·]/gu, "").trim()
}
```

VoiceOver then reads "People" instead of "People right arrow" at every existing call site (feed People/Groups links, settings Cancel links) with zero call-site edits.

- [ ] **Step 3: Gates** — same two `--force` commands as Task 1 Step 6; paste output.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(a11y): TextLink explicit accessibilityLabel, strip glyphs from accessible name (AC2.1)" -- apps/mobile/src/components/sirius.tsx
```

---

### Task 3: Settings screen gaps (Switch, name input, sub-component sweep)

**Files:**
- Modify: `src/app/(tabs)/settings.tsx` (biometric `<Switch>` ~312, name `<TextInput>` ~632)
- Possibly modify (sweep): `src/components/crash-diagnostics.tsx`, `src/components/invite-sheet.tsx`, and the files defining `SubscriptionSection` / `VoiceSection` (locate via settings.tsx imports)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks; Task 4 verifies, Task 5 cites.

- [ ] **Step 1: Label the biometric Switch (the audit's biggest gap)**

Read `settings.tsx:295-330` for the exact toggle title/subtitle variables, then give the `<Switch>` at ~312 an accessible name and link the visible description. Use the visible toggle title text verbatim as the label (do not invent copy — reuse the same string the sighted user sees, e.g. the `toggleTitle` content):

```tsx
<Switch
  // ...existing value/onValueChange/colors unchanged...
  accessibilityLabel={/* the exact visible toggleTitle string */}
  accessibilityHint={/* the exact visible toggleSub string */}
/>
```

(RN `Switch` already exposes the native switch role + on/off state — do not add `accessibilityRole` or a manual `checked` state.)

- [ ] **Step 2: Label the name TextInput**

At ~632 (inside EditableNameRow, whose visible "Name" `<Text>` label at ~608 is not programmatically linked):

```tsx
<TextInput
  // ...existing props unchanged...
  accessibilityLabel="Name"
/>
```

- [ ] **Step 3: Sweep the four uninspected settings sub-components**

For each of `CrashDiagnostics`, `InviteSheet`, `SubscriptionSection`, `VoiceSection`: enumerate every `Pressable`/`TouchableOpacity`/`Switch`/`TextInput` with line numbers and current props (AC2.1 inventory-table format). Fix any missing role/label/state using the same patterns as Steps 1-2 and Task 2. If a component turns out to have zero interactive elements or is already fully labeled, the inventory table saying so IS the deliverable — no edit for its own sake.

- [ ] **Step 4: Gates** — both `--force` commands; paste output.

- [ ] **Step 5: Commit** (adjust paths to what was actually edited)

```bash
git commit -m "feat(a11y): settings VoiceOver gaps — label biometric switch + name input + sub-component sweep (AC2.1, AC2.4)" -- apps/mobile/src/app/\(tabs\)/settings.tsx <other-edited-paths>
```

---

### Task 4: Feed + post-detail decorative fixes, then independent per-surface verification

**Files:**
- Modify: `src/components/friends-feed-list.tsx` (empty-state "∅" glyph ~223)
- Modify: `src/app/post/[slug]/index.tsx` (hero cover `Image` ~242)
- Verify (read-only): `src/app/(tabs)/feed.tsx`, `src/app/(tabs)/settings.tsx`, `src/app/(tabs)/tree.tsx`, `src/app/post/[slug]/index.tsx` + their labeled components

**Interfaces:**
- Consumes: Tasks 1-3 landed.
- Produces: four AC2.1-format element-inventory tables + AC2.2/2.3/2.4 evidence — the input to Task 5's doc.

- [ ] **Step 1: Hide the feed empty-state glyph**

In `friends-feed-list.tsx` ~223, the "∅" is decorative next to real empty-state copy:

```tsx
<Text style={styles.emptyGlyph} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
  ∅
</Text>
```

- [ ] **Step 2: Hide the post hero cover image**

AI-generated cover images are decorative (the title conveys the content). In `post/[slug]/index.tsx` ~242:

```tsx
<Image
  // ...existing source/style unchanged...
  accessible={false}
  accessibilityElementsHidden
  importantForAccessibility="no-hide-descendants"
/>
```

- [ ] **Step 3: Gates + commit the two fixes**

Both `--force` commands, paste output, then:

```bash
git commit -m "feat(a11y): hide decorative feed glyph + post cover image from VoiceOver (AC2.3)" -- apps/mobile/src/components/friends-feed-list.tsx "apps/mobile/src/app/post/[slug]/index.tsx"
```

- [ ] **Step 4: Independent verification (author ≠ verifier)**

Dispatch four parallel **verifier** subagents (fresh, none of them wrote Tasks 1-4 code), one per surface (feed, settings, tree, post detail), each under the binding rules, each returning the AC2.1 element-inventory table: every interactive element with line number, role, label (or justified exemption), plus AC2.2 composed-row-label templates, AC2.3 icon dispositions, AC2.4 state evidence. Any element missing from a table = that surface fails → fix and re-verify. Tree is expected to pass with zero edits (already compliant per the 2026-07-06 inventory) — its table is still required.

---

### Task 5: Write `docs/accessibility.md`

**Files:**
- Create: `docs/accessibility.md` (repo root docs/)

**Interfaces:**
- Consumes: Task 1 line citations, Task 4 inventory tables, `apps/mobile/docs/THEMING.md` (contrast + dual-theme evidence).
- Produces: the doc Task 6 verifies. Sections in this exact order:

1. **Header + scope** — what this doc is; phase 1 = four claims; maintained-links rule (update on any a11y code change).
2. Per label — **VoiceOver**, **Reduced Motion**, **Dark Interface**, **Sufficient Contrast** — three subsections each:
   - *Implementation:* behavior + file:line pointers (from Tasks 1-4 evidence; THEMING.md for the two free labels).
   - *App Store Connect answer:* in App Store Connect → your app → App Information → **Accessibility**, mark the feature **Supported** for iPhone/iPad. Include per-label the one-line justification to keep on file. Explicitly: do NOT mark Larger Text or Voice Control (phase 2); mark nothing until the device script below has passed — ACs 1.5/2.6 gate the claim, not the merge.
   - *On-device verification script:* exact steps, e.g. Reduced Motion: "Settings → Accessibility → Motion → Reduce Motion ON → open Sirius → Explore tab → Map: the focused-node glow must be static (no breathing), double-tap a node: camera lands instantly (no glide). Report: (a) glow static? (b) camera snap? (c) any other movement you noticed." VoiceOver: "Settings → Accessibility → VoiceOver ON (or triple-click side button) → complete: capture a note → check Queue → open Friends feed, swipe through 3 cards (each must read title + type as one unit) → open a post → change its audience → open Settings, toggle focus onto the biometric switch (must announce its name + on/off). Report any stop that reads as 'button' with no name, any fragment-by-fragment card, anything unreachable." Dark Interface: toggle appearance in iOS Settings → app follows. Sufficient Contrast: reference THEMING.md's WCAG-AA token audit; no device steps.
3. **Accessibility contract** (the invariants for new surfaces — from spec §Work item 3).
4. **Phase 2 backlog** (Dynamic Type → Larger Text, Voice Control pass, eslint-plugin-react-native-a11y, Differentiate Without Color Alone).
5. **AC status table** — all AC1.x/AC2.x/AC3.x rows with status; device ACs marked `pending user verification`.

- [ ] **Step 1: Write the doc** per the outline above, pulling real line numbers from Task 1/4 evidence — no invented pointers.
- [ ] **Step 2: Commit**

```bash
git commit -m "docs(a11y): accessibility evidence + ASC nutrition-label answers + device verification scripts (AC3.1, AC3.3, AC3.4)" -- docs/accessibility.md
```

---

### Task 6: Doc-claims verification + final AC roll-up

**Files:**
- Verify (read-only): `docs/accessibility.md` against the codebase
- Possibly modify: `docs/accessibility.md` (only to remove/correct unverifiable claims)

- [ ] **Step 1: Independent doc verifier (AC3.2)** — a fresh subagent (not the Task 5 author) checks every file:line pointer and factual claim in `docs/accessibility.md` against the code. Output: per-claim `confirmed` / `not confirmed + why`. Any `not confirmed` → correct or delete the claim, re-verify, then commit the correction (`-- docs/accessibility.md`).
- [ ] **Step 2: Final gates** — both `--force` commands one last time on the full landed state; paste output.
- [ ] **Step 3: AC roll-up to user** — present the complete AC table (AC1.1-1.5, AC2.1-2.6, AC3.1-3.4) with per-AC status + evidence pointers. AC1.5 and AC2.6 remain `pending user verification` with the doc's script names; explicitly tell the user which ASC boxes stay unchecked until they report back.
- [ ] **Step 4: Notify DarkCanyon** on the `ios-input-wipe` agent-mail thread that a11y phase 1 landed and which files changed (courtesy — no overlap expected).

## Task dependencies

Task 1, Task 2, Task 3 are independent → parallelizable (disjoint files). Task 4 needs 1-3 landed. Task 5 needs 4. Task 6 needs 5.
