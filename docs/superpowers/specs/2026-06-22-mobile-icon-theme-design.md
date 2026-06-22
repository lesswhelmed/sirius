# Mobile theme refresh — match the new app icon (dual light/dark)

Date: 2026-06-22
Status: Implemented (2026-06-22). See apps/mobile/docs/THEMING.md for the living contract.

## Context

The mobile app (`apps/mobile`, Expo/React Native) ships a single warm "paper-and-ink"
editorial theme (cream `#f3ecdc` + oxblood `#8b2e2a`), light-only, hardcoded in
`apps/mobile/src/constants/theme.ts` as the `Sirius` token object. 37 files consume it.

The new app icon is a different world: a black cat with luminous **sage-gold** eyes on a
**midnight-navy** ground. Extracted palette:

| Role in icon | Hex | Notes |
|---|---|---|
| Midnight ground (~80%) | `#131923` / `#161B24` | near-black navy |
| Steel-blue rim light | `#203049` `#334865` `#3C5B85` `#496A96` | cold mids |
| **Eye glow (signature)** | `#D3D7B6` `#B0B5A1` | pale luminous sage-gold |

The current theme clashes with this icon. Decision (confirmed with user):

1. **Dual theme** — keep cream paper as the **light** default; add a new **icon-navy dark**
   theme; switch by OS appearance (`userInterfaceStyle: "automatic"` is already set).
2. **Brand refresh** — mobile leads; web's palette can re-converge later. Divergence OK now.
3. **Tokenize everything** — none of the 39 currently-hardcoded colors may bypass the theme.
4. **Accessibility first** — every text pair clears WCAG AA (≥4.5:1); verified below.

Note: web's *default* theme is already a warm dark (`#15110d` + `#d65f57`); mobile only ever
mirrored web's *light* values. So adding a mobile dark theme moves it *closer* to web, not away.

## The palette (verified)

Token shape is unchanged (`color`, `font`, `radius`, `space`, `rule`) — we add a second
palette of the **same shape**. Light values are today's, with one AA fix.

### Light (cream paper) — default. Unchanged except `inkSubtle`.
```
paper #f3ecdc  paperRaised #eadfc6  paperSunken #e6d9bc  paperDeep #d9c39a
ink #1c1612    inkMuted #5a4f43     inkSubtle #665b4a (was #897d6d — AA fix)  inkFaint #b8a98e
accent #8b2e2a accentDeep #5a1c1a   accentSoft rgba(139,46,42,.10)  accentRing rgba(139,46,42,.45)
mark #c89530   sage #4a6741         onAccent #f3ecdc
```

### Dark (midnight navy, icon-derived) — NEW.
```
paper #131923  paperRaised #1b2230  paperSunken #0d121a  paperDeep #26344a
ink #e9ebdb    inkMuted #a7b0a0     inkSubtle #7f8a86    inkFaint #525d6b (decorative only)
accent #e0726a accentDeep #f0897f   accentSoft rgba(224,114,106,.16)  accentRing rgba(224,114,106,.5)
mark #cfd4b0   (the cat's-eye sage-gold)   sage #8fab80   steel #7d99c4 (icon rim light)  onAccent #15110d
rule rgba(233,235,219,.14)  ruleStrong rgba(233,235,219,.32)  ruleEmphatic rgba(233,235,219,.70)
```

### WCAG AA contrast (verified by script)
| Pair (dark theme) | Ratio | Verdict |
|---|---|---|
| ink on paper | 14.6:1 | AA text |
| inkMuted on paper | 7.9:1 | AA text |
| inkSubtle on paper | 4.9:1 | AA text |
| accent on paper / raised | 5.7 / 5.2:1 | AA text |
| mark (glow) on paper | 11.5:1 | AA text |
| sage / steel on paper | 7.0 / 6.1:1 | AA text |
| onAccent on accent | 6.1:1 | AA text |
| inkFaint on paper | 2.6:1 | decorative only — never text |

New token `steel` is dark-only (icon rim light) used for info/secondary glints; in light
theme `steel` aliases `inkMuted` so the type stays total.

## Architecture

The hard part: `Sirius.color.X` is read at **module load** inside `StyleSheet.create(...)`,
so static references can't react to a theme switch. Fix with a provider + themed-styles hook.

### New files
- `apps/mobile/src/constants/theme.ts` (rewrite) — exports `lightTheme`, `darkTheme` (same
  shape as today's `Sirius`), `type Theme`, `type ThemeColor`, plus `Fonts/Spacing/...`.
  Keep `export const Sirius = lightTheme` as a back-compat alias during migration.
- `apps/mobile/src/constants/theme-context.tsx` (new) — `ThemeProvider`, `useTheme(): Theme`,
  `useThemedStyles(factory: (t: Theme) => T): T` (memoized by active theme), and
  `usePostTypeTone()` / `useStatusPip()` replacing the static maps. Reads `useColorScheme()`
  (+ leaves a seam for a future manual user override stored in settings).

### Migration pattern (applies to all 37 consumers)
```ts
// before
const styles = StyleSheet.create({ screen: { backgroundColor: Sirius.color.paper } });
// after
function makeStyles(t: Theme) {
  return StyleSheet.create({ screen: { backgroundColor: t.color.paper } });
}
// in component:
const styles = useThemedStyles(makeStyles);
const t = useTheme(); // for inline JSX color props
```
Representative files: `src/components/sirius.tsx` (the primitive library — biggest),
`src/app/_layout.tsx`, `src/app/(tabs)/_layout.tsx` (NativeTabs chrome),
`src/components/post-markdown.tsx`, and the per-screen files under `src/app/**`.

### App-level chrome
- `src/app/_layout.tsx`: wrap the tree in `ThemeProvider`; build React Navigation theme
  objects from our palette (replace bare `DefaultTheme`/`DarkTheme`); `StatusBar style="auto"`.
- `src/app/(tabs)/_layout.tsx`: NativeTabs `backgroundColor/tintColor/iconColor/labelStyle`
  from `useTheme()`. The selected/indicator glint uses `mark` (the cat's-eye) in dark.
- `app.json`: splash + adaptive-icon `backgroundColor` already `#0A1F44` navy — align to
  `#131923` to match the icon ground exactly; keep `userInterfaceStyle: "automatic"`.
- `src/components/animated-icon.tsx`: replace the blue `#208AEF` splash gradient with the
  navy ground + sage-gold glow.

### Tokenizing the 39 bypass colors
Add semantic tokens so nothing is hardcoded:
- `color.success` / `color.danger` / `color.warning` (+ soft variants) — replaces
  `#2c7a4b` / `#a33` in `llm-test.tsx` (11) and `llm.tsx` (2).
- `color.scrim` — replaces `rgba(28,22,18,0.4)` in `sirius.tsx`.
- A small `scene` sub-palette for the 3D `space.tsx` (16) — per-theme dark scene colors.
- Splash gradient tokens for `animated-icon.tsx`.
Both light and dark define all of these so every screen is fully themed in both modes.

## Build sequence

1. Rewrite `theme.ts` → `lightTheme`/`darkTheme` + types + back-compat `Sirius` alias.
2. Add `theme-context.tsx` (provider, `useTheme`, `useThemedStyles`, tone/pip hooks).
3. Wrap app in `ThemeProvider`; wire nav themes + status bar + NativeTabs chrome.
4. Migrate `components/sirius.tsx` (unblocks every screen that uses primitives).
5. Migrate the remaining ~35 consumers to `useThemedStyles` / `useTheme` (mechanical;
   fan out across agents by directory: `(tabs)`, `(auth)`, `post/*`, `components/*`, `explore/*`).
6. Tokenize the 39 bypass colors against the new semantic tokens.
7. Update `app.json` + `animated-icon.tsx` splash to the navy ground.
8. Remove dead exports (`Colors`, unused `Spacing`/`MaxContentWidth`) once nothing references them.
9. Document the system (see below).

## Documentation

- A `## Theming` section in `apps/mobile/README` (or a new `apps/mobile/docs/THEMING.md`):
  the token list, light/dark values, the `useTheme`/`useThemedStyles` pattern, how to add a
  token, the AA contract, and the "evolve web later" note.
- Header comment in `theme.ts` documenting the single-source-of-truth contract.

## Verification

- `bun run check-types` and `bun run lint` (mobile) — zero errors/warnings.
- Grep guard: no `#[0-9a-fA-F]{3,6}` / `rgba(` literals remain in `src/**` except inside
  `theme.ts` token definitions.
- Re-run the contrast script over the final token values — all text pairs ≥4.5:1.
- Manual: launch the app in the iOS simulator, toggle Appearance Light↔Dark (Settings or
  `xcrun simctl ui booted appearance dark`), walk every tab + a post detail + an auth screen
  + a sheet + `/llm` and confirm both themes render correctly and switch live.
- Confirm splash/icon ground reads as the icon navy.

## Out of scope (this pass)

- Evolving the **web** palette to re-converge (planned follow-up).
- A manual in-app theme picker (the `useColorScheme` seam is left for it).
- Reduced-motion / other a11y axes beyond color contrast.
