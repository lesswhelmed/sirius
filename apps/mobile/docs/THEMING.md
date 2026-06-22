# Theming the mobile app

The Sirius mobile client has **one source of truth** for color, type, spacing,
radius and rules — `src/constants/theme.ts` — and a tiny runtime in
`src/constants/theme-context.tsx` that selects the active theme by OS appearance.
This doc is the contract: read it before adding a color or a screen.

## The two themes

| | Light (default) | Dark (icon-derived) |
|---|---|---|
| Mood | warm cream "paper-and-ink" editorial | nocturnal midnight-navy from the app icon |
| ground `paper` | `#f3ecdc` | `#131923` (the icon's near-black navy) |
| text `ink` | `#1c1612` | `#e9ebdb` |
| `accent` (primary action) | `#8b2e2a` oxblood | `#e0726a` brightened oxblood |
| `mark` (highlight / glow) | `#c89530` mustard | `#cfd4b0` **the cat's-eye sage-gold** |
| `steel` (info / rim) | `#3f5774` | `#7d99c4` (the icon's steel-blue rim light) |

The dark theme is pulled straight from the new app icon — a black cat with
luminous sage-gold eyes on midnight navy. The light theme is the app's original
identity (mirrors the web app's light palette).

The active theme follows the **OS appearance** setting
(`app.json` → `userInterfaceStyle: "automatic"`). There is no in-app picker yet;
the seam for one is in `ThemeProvider` (resolve a stored preference before the OS
scheme).

## Token groups (`t.color`, `t.space`, `t.font`, `t.radius`, `t.rule`)

`color`: `paper / paperRaised / paperSunken / paperDeep` (surfaces),
`ink / inkMuted / inkSubtle / inkFaint` (text; `inkFaint` is decorative ONLY —
fails AA as text by design), `rule / ruleStrong / ruleEmphatic` (hairlines),
`accent / accentDeep / accentSoft / accentRing` (primary action),
`mark / markSoft / markText` (highlight; `markText` is the legible-as-text
variant), `sage / sageSoft`, `steel / steelSoft` (info/secondary),
`success / successSoft`, `danger / dangerSoft`, `warning / warningSoft` (states),
`scrim` (modal backdrop), `onAccent / onMark` (text on filled surfaces), and
`scene.*` (the 3D embedding map — intentionally a night sky in BOTH themes).

`space`: `xs 4 / sm 8 / md 12 / lg 16 / xl 24 / xxl 32`.
`font`: `serif / sans / mono`. `radius`: `none 0 / pill 999`.
`rule`: `hairline 1 / emphatic 1.5`.

## How to consume the theme

**Never** read tokens at module scope inside `StyleSheet.create` — that snapshots
one theme and can't switch. Use the hooks from `@/constants/theme-context`:

```tsx
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";

function makeStyles(t: Theme) {
  return StyleSheet.create({
    screen: { backgroundColor: t.color.paper },
    title: { color: t.color.ink, fontFamily: t.font.serif },
  });
}

export function MyScreen() {
  const t = useTheme();                       // inline color props in JSX
  const styles = useThemedStyles(makeStyles); // the stylesheet
  return <View style={styles.screen}><ActivityIndicator color={t.color.accent} /></View>;
}
```

Rules:
- Call the hooks **unconditionally at the top** of each component (React Compiler
  is on). If several components in a file share one `makeStyles`, each calls
  `useThemedStyles(makeStyles)`.
- Hooks can't go in default parameter values — resolve defaults in the body
  (`const tone = props.tone ?? t.color.accent`).
- Non-component helpers that need a color take `t: Theme` as a parameter.
- Post-type / status colors: use `usePostTypeTone()` / `useStatusPip()` (theme-
  derived) instead of importing static maps.
- If a value passes into a list `renderItem` wrapped in `useCallback`, include
  `t` / `styles` / the tone map in its dependency array so the list restyles on a
  live theme switch.

## How to add a token

1. Add the key to `ColorTokens` in `theme.ts`.
2. Give it a value in **both** `lightColor` and `darkColor` (the type makes a
   missing one a compile error).
3. If it's used as text, verify it clears the accessibility contract below.

## Accessibility contract (WCAG AA)

Every token used as **text** clears AA (≥4.5:1) on its intended ground in both
themes — verified. `inkFaint` (≈2.6:1) is decorative only and never used for text.
When adding/altering a text token, check contrast (e.g. a WCAG ratio script
against `paper` / `paperRaised`) before committing. The light theme's `inkSubtle`
is intentionally `#665b4a` (darker than the old `#897d6d`) to clear AA.

## Brand note (web parity)

Mobile **leads** this icon-aligned refresh. The web palette is planned to
re-converge later, so until then the dark theme's hue may differ between platforms
(mobile dark = cool navy; web dark = warm near-black). Light themes already match.

## The launch splash

`src/components/animated-icon.tsx` and `app.json` (splash + adaptive-icon
`backgroundColor: #131923`) use the icon's own navy ground in BOTH themes — the
splash is brand identity, intentionally not theme-switched. It reads the navy/glow
from `darkTheme.color.*` rather than a raw literal.
