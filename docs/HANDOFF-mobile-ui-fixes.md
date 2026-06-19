# HANDOFF — Mobile UI fixes (composer header, queue jitter, note keyboard, sign-in autofill)

Date: 2026-06-13. Four mobile (`apps/mobile`) UX defects reported from real device use,
fixed in parallel by three Agent-Mail-coordinated agents. All JS/TS — no native rebuild
needed (Metro hot-reloads). `bun run lint` + `bun run check-types` pass clean for `mobile`.

## 1 — Composer header was cramped & mis-tap-prone

`apps/mobile/src/app/(tabs)/composer.tsx`

- **Symptom:** "Manage focus", "On-device AI", "Sign out" stacked in the top-right corner
  with an 8px gap. Each `TextLink` carries `hitSlop={12}`, so adjacent tap zones overlapped —
  the destructive "Sign out" sat one slip away from the nav links.
- **Fix:** `header` is now a column. The two nav links live in a horizontal `headerToolbar`
  row (`gap: Sirius.space.xl`, `flexWrap`) capped by a hairline divider
  (`borderBottomWidth: 1, borderColor: Sirius.color.rule`). "Sign out" sits on its own
  right-aligned row (`headerSignOut`) below the divider. Removed the old `headerLinks` style.
  `TextLink` component signature untouched.

## 2 — Queue screen self-scrolled / flickered every 5s

`apps/mobile/src/app/(tabs)/queue.tsx`

- **Root cause:** `RefreshControl refreshing={isRefetching}`. React Query's `isRefetching`
  flips `true` on every 5s background poll (`refetchInterval: 5000`), and iOS FlatList
  animates a scroll to reveal the spinner whenever `refreshing` becomes true → the list
  "randomly scrolled down by itself and refreshed."
- **Fix:** Decoupled manual pull-to-refresh from background polling. Added local
  `manualRefreshing` state + an `onRefresh` callback that toggles it around `refetch()`;
  `RefreshControl` now binds `refreshing={manualRefreshing}` / `onRefresh={onRefresh}`.
  Polling stays at 5s but updates silently. Removed the now-unused `isRefetching` destructure
  (project lints `--max-warnings 0`).

## 3 — Note/link sheet keyboard covered the input

`apps/mobile/src/components/sirius.tsx` (`Sheet`)

- **Root cause:** `Sheet` is a React Native `Modal` rendered in a separate native window, so
  the composer's outer `KeyboardAvoidingView` could not lift it; the bottom-anchored sheet's
  `autoFocus` `TextInput` was hidden behind the keyboard.
- **Fix:** Wrapped the `Modal`'s scrim + sheet in a `KeyboardAvoidingView`
  (`behavior={Platform.OS === "ios" ? "padding" : "height"}`). Sheet API unchanged; benefits
  both the note/link sheet and the audio sheet.

## 4 — Sign-in form didn't trigger iOS autofill

`apps/mobile/src/app/(auth)/sign-in.tsx` + parity in `sign-up.tsx`

- The shared `Field` spreads props to the underlying `TextInput`, so no component change.
- **sign-in:** email → `textContentType="username"` + `importantForAutofill="yes"`;
  password → `textContentType="password"` + `importantForAutofill="yes"` (kept
  `autoComplete="password"` — correct for sign-in, not `new-password`).
- **sign-up (parity):** name → `textContentType="name"`; email →
  `textContentType="emailAddress"`; password → `textContentType="newPassword"`; emails/passwords
  also get `importantForAutofill="yes"`.

## Coordination

Three parallel agents via MCP Agent Mail on project
`/Users/minasaleeb/workspaces/sirius-2-simple` (disjoint file reservations, zero conflicts):
`SnowyGorge` (composer.tsx + sirius.tsx), `SilentGlacier` (queue.tsx),
`IvoryCompass` (auth forms). Orchestrator `AmberHarbor`.

## Remaining: on-simulator behavioral verification

Static checks pass; the behavioral confirmations still want a booted sim/device:

1. Queue tab — watch ~15s: no self-scroll/spinner on background polls; manual pull still spins.
2. Composer → "note": keyboard opens, field + "Add to tray" ride above it, typed text readable.
3. Composer header: nav links spaced, "Sign out" separated; no mis-tap overlap; VoiceOver order sane.
4. Sign-in: focus email/password → iOS QuickType password-autofill bar appears.
