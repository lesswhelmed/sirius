# Accessibility — Sirius iOS app

This is the evidence-and-answers doc behind Sirius's **Accessibility Nutrition
Labels** in App Store Connect. It backs four claims and nothing more:

| Label                   | Status                          | Nature of the work                      |
| ----------------------- | ------------------------------- | --------------------------------------- |
| **VoiceOver**           | supported (device pass pending) | targeted labeling of four thin surfaces |
| **Reduced Motion**      | supported (device pass pending) | guarded the 3D Explore/Space scenes     |
| **Dark Interface**      | supported                       | already true — dual light/dark theme    |
| **Sufficient Contrast** | supported                       | already true — WCAG-AA token audit      |

Scope is `apps/mobile` only. The web app (`apps/web`) is **not** covered by these
claims. Phase 1 deliberately does **not** claim Larger Text (Dynamic Type) or
Voice Control — see the phase-2 backlog.

**Maintained-links rule.** Every file pointer below is load-bearing. When you
change accessibility code in a cited file, update the pointer here in the same
change, and re-run the on-device script for the affected label before re-asserting
the claim. The pointers were verified against the tree on 2026-07-06 (commits
`e0787d5`, `ff4a034`, `82be19e`, `e2aa17d`, `3110fcc`); line numbers drift, so
grep the quoted symbol if a number no longer matches.

**The device gate.** Two acceptance criteria — reduce-motion on device (AC1.5) and
the VoiceOver core loop on device (AC2.6) — are `pending user verification`. The
static code evidence below is necessary but not sufficient to mark a label in App
Store Connect. **Do not mark ANY label Supported until its on-device script has
passed.** The scripts are the release gate.

---

## VoiceOver

### Implementation

VoiceOver support is the reader hitting every interactive stop with a sensible
role + name, list rows reading as one unit, decorative art staying silent, and
stateful controls announcing their state. The four surfaces that were thin
(`feed`, `settings`, `tree`, `post/[slug]`) were brought up to the composer's
standard; the shared primitives in `src/components/sirius.tsx` carry the roles for
everything built on them.

**Shared primitives (`src/components/sirius.tsx`).**

- `PrimaryButton` sets `accessibilityRole="button"` +
  `accessibilityState={{ disabled, busy }}` (`:589-590`); `SecondaryButton` does
  the same (`:622-623`). Every button in the app inherits this.
- `TextLink` accepts an optional `accessibilityLabel`; when absent it strips
  decorative glyphs from the visible label so the reader hears "People", not
  "People right-arrow": `accessibilityLabel ?? label.replace(/[→←▸▹›‹✕·]/gu, "").trim()`
  (`:667`).
- The `Sheet` scrim and close control are labeled "Close" and the drag handle is
  `accessibilityElementsHidden` (`:822`).

**Feed — `src/components/friends-feed-list.tsx`.** Each card is a single accessible
`Pressable`. iOS treats an accessible view as atomic and does not descend into its
subtree, so the row's nested controls (author-handle link, moderation "···",
GROUP-audience badge) are unreachable by swipe on their own. They are instead
exposed two ways that cannot drift from the visible UI:

- **Composed label** (`:183-185`): `` `${title} — ${typeLabel}` `` + `, by
${authorLine}` (when an author renders) + `, shared with ${audienceInfo.label}`
  (when the owner audience badge renders) — e.g. "How I built X — Finding, by
  @mina, shared with Friends".
- **VoiceOver custom actions** (`:187-205` build the list, `:207-221` dispatch,
  `:227-229` wire `accessibilityActions` + `onAccessibilityAction` onto the row).
  `open-author`, `more-actions`, and `manage-group` each call the exact same
  helper the corresponding nested `Pressable`'s `onPress` calls, and are only
  offered when that control actually renders.
- The empty-state "∅" glyph is `accessibilityElementsHidden` (`:303`).

**Settings — `src/app/(tabs)/settings.tsx` + sub-components.** The biometric
`Switch` carries `accessibilityLabel={biometricToggleTitle}` +
`accessibilityHint={biometricToggleSub}` (`:321-322`), both derived from the same
strings the visible title/subtitle render so they cannot diverge; no manual role
is added — RN's native `Switch` exposes the switch role + on/off state for free.
The name field sets `accessibilityLabel="Name"` (`:645`). The diagnostics
disclosure carries `accessibilityState={{ expanded: diagVisible }}` (`:354`); the
crash-diagnostics trigger the same (`crash-diagnostics.tsx:90`). In
`voice-section.tsx` the generator disclosure has an explicit label +
`accessibilityState={{ expanded }}` (`:154`) with its chevron hidden (`:163`), and
the "Copy prompt" label tracks the copied state (`:180`). The invite sheet's copy
button announces "Copied" (glyph-free) via an explicit label (`invite-sheet.tsx:88`).

**Tree/Explore — `src/app/(tabs)/tree.tsx` + `segmented.tsx` + `explore/`.** The
Map/Categories/Focus switch is a real `tablist` (`segmented.tsx:47`) of `tab`s
(`:72`) each carrying `accessibilityState={{ selected: active }}` (`:74`) — this is
the switch a reader uses to leave the 3D canvas (which is out of scope as a visual
surface) and reach the flat, labeled outline. Outline rows compose
`` `${label}, ${count} posts` `` (`tree.tsx:647-649`); the expand caret is a
separate stop with `accessibilityState={{ expanded: isOpen }}` (`:625`). The filter
field is labeled (`:333`) and its clear button (`:340`). Inside `map-view.tsx`, the
post-index sheet handles announce "Raise/Lower post index" with
`accessibilityState={{ expanded }}` (`:258-259`, `:279-281`) and the breadcrumb
announces "Up to {label}" (`:298`).

**Post detail — `src/app/post/[slug]/index.tsx` + imports.** The hero cover image
carries the full decorative triad — `accessible={false}` +
`accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`
(`:252-254`). The four owner action rows use explicit verb-led labels ("Change
audience" `:291`, "Edit post" `:304`, "Delete post" `:324`, "Report this post or
block its author" `:349`) so the reader hears the action, not "Audience Edit".
Gallery images fall back to `` `Post image ${index + 1}` `` when they carry no alt
text, so an alt-less image is never a silent unlabeled stop (`:84`, `:92`). The
audio player's seek control implements the `adjustable` contract:
`accessibilityValue={{ min:0, max:100, now }}` (`original-content-section.tsx:142`)
plus increment/decrement actions (`:143-147`) that step the same 10-second
`seekToSeconds` helper the tap path uses (`:110-117`).

**Auth-screen focus survival (coordination note).** Verified with coworker agent
DarkCanyon on the iOS input-wipe fix (agent-mail thread `ios-input-wipe`, msgs
439-441): the auth client sets `refetchOnWindowFocus: false`
(`src/lib/auth-client.ts:19`) and the `(auth)` layout never swaps the auth `Stack`
out during a session refetch — it gates on the hook's own state,
`isPending && !isRefetching` (`src/app/(auth)/_layout.tsx:16`), rather than a local
latch. Previously each background/foreground remounted the Stack, destroying
VoiceOver focus and wiping the uncontrolled `AuthField` inputs mid sign-in. Nuance
to keep in mind when testing: **on a true cold start the sign-in form renders while
the first session fetch is in flight (briefly interactive before a possible
redirect for signed-in deep links).**

### App Store Connect answer

In App Store Connect → your app → **App Information → Accessibility**
(Accessibility Nutrition Labels), mark **VoiceOver** Supported for **iPhone and
iPad** — but only after the on-device script below passes (see the device gate).
Justification to keep on file: "Every interactive control across the core loop
(capture, in-flight processing, feed, post detail, audience change, settings) carries an
accessibilityRole and a meaningful accessibilityLabel; list rows read as a single
composed unit with custom actions for nested controls; decorative art is hidden;
stateful controls announce state. Evidence: `docs/accessibility.md` → VoiceOver."

### On-device verification script

1. iPhone/iPad **Settings → Accessibility → VoiceOver → ON** (or set the
   Accessibility Shortcut and triple-click the side button to toggle it quickly).
2. Open Sirius. With VoiceOver on, you tap once to focus/hear an item and
   double-tap to activate it; swipe right/left to move between stops.
3. Walk the core loop:
   - **Capture** a note (Capture tab → type a note → submit).
   - Open **Catalog** — while your capture is processing it appears at the top
     under **In flight**; wait for it to finish and confirm the completed post
     is announced.
   - Open the **Friends** feed and swipe through 3 cards. Each card must read as
     **one stop** giving title + type (and author/audience when shown) — not four
     separate text fragments.
   - On a friend's card, with the card focused, swipe **up or down** with one
     finger to move through its custom actions ("Actions available") and reach
     Report/Block or Open author; double-tap to activate the selected action.
   - **Open a post** and change its **audience** (Change audience → pick a tier →
     Save).
   - Open **Settings** and move focus onto the **Face ID / Touch ID switch**: it
     must announce its name **and** its on/off state.
4. **Report back:**
   - (a) Any stop that reads as just "button" with **no name**.
   - (b) Any feed card that reads **fragment-by-fragment** instead of one unit.
   - (c) Anything **unreachable** by swiping (e.g. the Report/Block action).
   - (d) Did the biometric switch announce its **on/off state**?
   - (e) Any control whose spoken state disagreed with what you see.

---

## Reduced Motion

### Implementation

Apple's bar is reducing _unnecessary / vestibular-triggering_ motion — ambient,
looping, or idle animation — not freezing functional one-shot transitions. The
only ambient motion in the app is in the two Three.js scenes; both consume
`useReducedMotion()` from `src/lib/a11y.ts` (`:15`).

**Explore scene — `src/components/explore/constellation-scene.tsx`.**

- `PulseHalo`'s per-frame glow pulse is stilled when reduce-motion is on: it snaps
  to a static mid-range glow (`m.scale.setScalar(1)`, `mat.opacity = 0.24`) and
  early-returns before any trig runs (`:501-503`).
- `CameraRig` replaces the per-frame easing factor with `const d = reduced ? 1 :
DAMPING` (`:644`), so the camera **snaps** to its target instead of gliding —
  applied to yaw, pitch, target, radius, and the bottom-sheet lift. `d = 1` means
  "arrive this frame".
- The hook is read once outside the Canvas (`:848`) and passed to both
  `CameraRig` (`:1004`) and `PulseHalo` (`:1049`).
- Rendering itself never stops: `state.gl.render(...)` and the GL error flush stay
  unconditional in every `useFrame`.

**Standalone Space screen — `src/app/space.tsx`.** The orbit `CameraRig` uses the
same pattern: `const d = reduced ? 1 : ORBIT_DAMPING` (`:87`) for yaw and pitch,
with the hook read in `LoadedSpace` (`:149`) and threaded down (`:176`).

**Animation sweep (exhaustive, from Task 1).** Every continuous/looping animation
site in `apps/mobile/src` was enumerated. Guarded ambient sites: the two
`CameraRig`s and `PulseHalo` above. Everything else is an exempt **one-shot
functional transition** and is intentionally left alone: the sheet-close tween
(`sirius.tsx:783`), the save-confirm scale bounce (`sirius.tsx:971-973`), the
collapsible chevron rotate (`collapsible.tsx:44`), and the map-view sheet-height
tween (`map-view.tsx:85`). `LabelProjector` (`constellation-scene.tsx:710`) is a
reactive projection that settles instantly once the camera snaps, so it needs no
guard. There are **no** `withRepeat` / `Animated.loop` sites in the codebase.

### App Store Connect answer

Mark **Reduced Motion** Supported for **iPhone and iPad** — after the device
script passes. Justification: "The only ambient motion is the 3D embedding scenes;
both honor the OS Reduce Motion setting via `useReducedMotion()` — the halo pulse
holds static and the camera snaps rather than glides, while functional one-shot
transitions (sheets, toggles) are intentionally preserved. Evidence:
`docs/accessibility.md` → Reduced Motion."

### On-device verification script

1. iPhone/iPad **Settings → Accessibility → Motion → Reduce Motion → ON**.
2. Open Sirius → **Explore** tab → **Map** view.
3. Watch the focused node's glow: it must be **static** — no breathing/pulsing.
4. **Double-tap a node** (or tap a category to focus it): the camera must **land
   instantly** — no glide/tween/drift.
5. Open the **Space** screen (embedding map) if reachable and confirm the same —
   no idle camera drift.
6. **Report back:**
   - (a) Is the focused-node glow **static** (no breathing)?
   - (b) Does the camera **snap** on focus (no glide)?
   - (c) Any other ongoing/looping movement you noticed anywhere in the app.

---

## Dark Interface

### Implementation

The app ships a full **dual light/dark theme**, not a tint. Both themes are defined
in a single source of truth, `src/constants/theme.ts`, and selected at runtime by
OS appearance in `src/constants/theme-context.tsx`. The dark theme is the
midnight-navy palette derived from the app icon; the light theme is the warm cream
"paper-and-ink" identity. The OS appearance drives it via
`app.json → userInterfaceStyle: "automatic"`. Full contract:
`apps/mobile/docs/THEMING.md`. (The launch splash and the 3D scene ground are
intentionally navy in both themes — brand identity, per THEMING.md — which is not
a dark-mode defect.)

### App Store Connect answer

Mark **Dark Interface** Supported for **iPhone and iPad**. Justification: "The app
provides a complete dark theme selected automatically by the system appearance
setting (`userInterfaceStyle: automatic`), with every color token defined for both
themes in a single source. Evidence: `apps/mobile/docs/THEMING.md`."

This label is already true from code; no new implementation gated it. Confirm once
by toggling appearance (below).

### On-device verification script

1. iPhone/iPad **Settings → Display & Brightness → Dark** (then **Light**). (Or use
   Control Center's appearance toggle.)
2. Open Sirius after each switch — the app's background, text, and accents must
   **follow the system appearance** (cream in Light, midnight-navy in Dark).
3. **Report back:** any screen that stays in the wrong appearance, or any text that
   becomes hard to read after the switch.

---

## Sufficient Contrast

### Implementation

Every color token used **as text** clears WCAG-AA (≥4.5:1) on its intended ground
in **both** themes — this is an audited contract, not an aspiration. See
`apps/mobile/docs/THEMING.md` → "Accessibility contract (WCAG AA)". The one
sub-AA token, `inkFaint` (≈2.6:1), is decorative-only and by contract never used
for text; the light theme's `inkSubtle` was darkened to `#665b4a` specifically to
clear AA. Adding or altering a text token requires re-checking its ratio before
committing (the contract spells this out).

### App Store Connect answer

Mark **Sufficient Contrast** Supported for **iPhone and iPad**. Justification: "All
text-bearing color tokens are verified ≥4.5:1 against their ground in both light
and dark themes; the single sub-AA token is decorative-only and never used for
text. Evidence: `apps/mobile/docs/THEMING.md` → Accessibility contract."

This label is already true from the theme audit; no device toggle is required.

### On-device verification script

None required — this claim rests on the static WCAG-AA token audit in
`apps/mobile/docs/THEMING.md`, not on a runtime setting. If a new text color is
introduced, re-run a WCAG ratio check against `paper` / `paperRaised` in both
themes per the THEMING.md contract before re-asserting this label.

---

## Accessibility contract (for every new surface)

New screens and components must uphold these invariants — the same standard the
phase-1 work brought the four thin surfaces up to:

1. **Every interactive element is labeled and roled.** Every `Pressable`,
   `TouchableOpacity`, `Switch`, `TextInput`, and tappable link has an
   `accessibilityRole` and a meaningful `accessibilityLabel`. Prefer the shared
   `PrimaryButton` / `SecondaryButton` / `TextLink` / `AuthField` primitives in
   `sirius.tsx`, which carry roles/state for you. Add an `accessibilityHint` only
   when the action isn't obvious from the label.
2. **Rows read as one unit.** A repeated list row is a single accessible container
   with a composed label ("Title, by handle, shared with Friends"), not four
   stepped-through fragments. If the row nests its own controls, expose them via
   `accessibilityActions` + `onAccessibilityAction` on the row (iOS absorbs a
   nested control's subtree into the parent's atomic element).
3. **Decorative art is silent.** Icons, glyphs, and non-informative images are
   hidden (`accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`,
   or `accessible={false}`, or simply not focusable). Meaningful images get a real
   label (with a sensible fallback when none is authored).
4. **Stateful controls announce state.** Toggles, tabs, checkboxes, and
   expand/collapse controls carry `accessibilityState`
   (`selected`/`disabled`/`expanded`/`checked`); adjustable controls carry
   `accessibilityValue` + increment/decrement actions.
5. **Ambient motion is guarded.** Any continuous/looping/idle animation (a
   `useFrame` loop, `withRepeat`, ambient `withSpring`/`withTiming`) reads
   `useReducedMotion()` and holds static / snaps when it is on. One-shot functional
   transitions are exempt.
6. **Contrast per THEMING.md.** Any token used as text clears WCAG-AA (≥4.5:1) in
   both themes.

---

## Phase 2 backlog

Not claimed in phase 1; each needs real work before its label is honest.

- **Dynamic Type → Larger Text.** No font-size token scale, no
  `maxFontSizeMultiplier` clamps, untested at accessibility sizes. Needs a scaled
  type ramp + clamps + large-size testing before claiming **Larger Text**. **Do
  not mark Larger Text in ASC** until this lands.
- **Voice Control pass.** No dedicated verification that every control is reachable
  and activatable by name via Voice Control. **Do not mark Voice Control in ASC**
  until this pass is done.
- **`eslint-plugin-react-native-a11y` enforcement.** Wire a lint rule set so
  missing roles/labels fail CI instead of relying on manual sweeps.
- **Differentiate Without Color Alone.** Audit any state conveyed by color only
  (e.g. status pips, audience pills) and add a non-color cue (glyph/label).

### Known minor polish (non-blocking)

- The audio seek control's `accessibilityValue` omits the optional `text` field,
  so VoiceOver announces a bare percentage ("42 percent") rather than a time
  ("1:10 of 2:47"). Visible UI shows times; adding `text` would align them
  (`original-content-section.tsx:142`).
- `SecondaryButton` spreads `{...rest}` **after** its own
  `accessibilityState={{ disabled, busy }}` (`sirius.tsx:623`, `:631`), so a caller
  passing a custom `accessibilityState` **replaces** rather than merges the
  disabled/busy default. Latent only — no current caller passes both a custom
  state and `disabled`/`busy`. A merge inside the component would close the trap.
- `TextLink`'s glyph-stripping fallback would yield an **empty string** for a
  glyph-only label (`sirius.tsx:667`). No current call site is glyph-only; a
  glyph-only `TextLink` in future must pass an explicit `accessibilityLabel`.

---

## AC status table

Acceptance criteria from the phase-1 design spec
(`docs/superpowers/specs/2026-07-06-ios-accessibility-phase1-design.md`).

| AC        | What it covers                                                              | Status                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1.1** | `constellation-scene.tsx` consumes `useReducedMotion()`                     | **pass** — import + hook at `constellation-scene.tsx:848`; `space.tsx:18/149`                                                                                 |
| **AC1.2** | Reduce-motion ON ⇒ no ambient per-frame motion; camera snaps                | **pass** — PulseHalo static `:501-503`; `d = reduced ? 1 : DAMPING` `:644`; `space.tsx:87`; `gl.render` never skipped                                         |
| **AC1.3** | Animation sweep exhaustive + dispositioned                                  | **pass** — all `useFrame` sites guarded/exempt; 0 `withRepeat`/`Animated.loop`; one-shots exempt (see Reduced Motion)                                         |
| **AC1.4** | `check-types` + `lint` (`--force`) pass, output pasted                      | **pass** — Task 1 report: 6/6 check-types, 5/5 lint                                                                                                           |
| **AC1.5** | Reduce-motion script passes on device                                       | **pending user verification**                                                                                                                                 |
| **AC2.1** | Zero unlabeled interactive elements in swept surfaces                       | **pass** — inventory tables in `verify-{feed,settings,tree,post}.md`; feed nested controls exposed via custom actions (`friends-feed-list.tsx:187-229`)       |
| **AC2.2** | Repeated rows are single composed accessible units                          | **pass** — feed `:183-185`, tree `:647-649`, post rows explicit labels                                                                                        |
| **AC2.3** | Decorative hidden; meaningful images labeled                                | **pass** — feed ∅ `:303`, post hero triad `:252-254`, gallery alt fallback `:84/:92`                                                                          |
| **AC2.4** | Stateful controls carry `accessibilityState`/value                          | **pass** — biometric Switch (native), tabs `segmented.tsx:74`, expands `settings.tsx:354`/`crash-diagnostics.tsx:90`, seek `original-content-section.tsx:142` |
| **AC2.5** | `check-types` + `lint` (`--force`) pass, output pasted                      | **pass** — Task 3/4 reports: 6/6 check-types, 5/5 lint                                                                                                        |
| **AC2.6** | VoiceOver core-loop script passes on device                                 | **pending user verification**                                                                                                                                 |
| **AC3.1** | This doc exists with 4 label sections (×3 subsections) + contract + backlog | **pass** — this document                                                                                                                                      |
| **AC3.2** | Independent verifier confirms every pointer                                 | **pass** — verifier reports `verify-{feed,settings,tree,post}.md`, round-1 re-verify sections                                                                 |
| **AC3.3** | Scripts executable by a non-engineer                                        | **pass** — exact Settings paths + in-app steps + report-back points above                                                                                     |
| **AC3.4** | ASC answers only claim what evidence supports; device-pending marked        | **pass** — device gate stated up front; AC1.5/AC2.6 marked pending; Larger Text / Voice Control excluded                                                      |

Device-gated ACs (AC1.5, AC2.6) stay **open** until the user runs the scripts on
hardware and confirms. No App Store Connect label may be marked Supported before
its script passes.
