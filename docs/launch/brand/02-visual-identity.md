# Sirius — Visual Identity

_The design system of record: wordmark, the cat icon, the full color system, type, the editorial/zero-radius rules, imagery, and accessibility. Last updated 2026-06-29._

Sirius looks like a well-set newspaper, not a SaaS dashboard. **Flat, ruled, editorial.** One shape language across two themes. Every token below is real, pulled from the codebase — use the exact hex.

---

## I. Wordmark

- The wordmark is the single word **Sirius**, set in the display serif (Instrument Serif; New York on iOS).
- **Capitalization:** initial cap only — **Sirius.** Never all-caps "SIRIUS" in running copy, never lowercase "sirius."
- **No co-branding.** The wordmark stands alone. Never lock it up with "lesswhelmed" as a descriptor (lesswhelmed is the domain and the promise, not part of the mark — see [Naming](./03-naming-nomenclature.md)).
- **Clearspace:** keep a margin of at least the cap-height of the "S" on all sides. Don't crowd it with rules, badges, or other type.
- **Don't:** add a tagline _inside_ the lockup, stretch or condense it, apply gradients, or set it in the mono face.

---

## II. The cat icon

The app icon is a **black cat with luminous sage-gold eyes, on a midnight-navy ground, peeking out of a black bag.**

**Meaning (use quietly, never captioned):** a cat sees in the dark — it finds signal in your clutter. It's curious. "Letting the cat out of the bag" = revealing what matters. The star Sirius is the guide; the cat is the knowing, nocturnal companion that does the seeing.

| Correct usage | Incorrect usage |
| --- | --- |
| Full-bleed midnight-navy ground (#131923) behind the cat | Recoloring the ground to a brand-foreign color |
| Sage-gold eyes as the focal glow (#cfd4b0) | Changing eye color or adding extra facial features |
| Used at the corners required (App Store auto-masks) | Adding your own rounded corners or drop shadows |
| As a quiet motif in marketing — small, atmospheric | Animating it into a mascot or giving it a name/voice |
| Zero-radius everywhere else; icon keeps the platform mask | Over-explaining the cat in body copy |

**Clearspace for the icon mark in marketing:** at least 25% of the icon's width on every side.

---

## III. Color system

Two themes, one shape. **Light ("paper-and-ink") is the default and historical identity.** Dark ("midnight-navy") is derived from the app icon. Every text color below meets the WCAG-AA contrast contract against its intended background.

### Light theme — "paper-and-ink"

| Token | Hex | Role |
| --- | --- | --- |
| Paper (ground) | `#f3ecdc` | Primary background |
| Raised | `#eadfc6` | Cards, raised surfaces |
| Ink | `#1c1612` | Primary text |
| Muted ink | `#5a4f43` | Secondary text, captions |
| Oxblood accent | `#8b2e2a` | **Primary action** (buttons, links-as-action) |
| Mustard mark | `#c89530` | Highlight/mark fill |
| Mustard (as text) | `#876012` | Mustard used as legible text |
| Sage | `#4a6741` | Success / positive, secondary accent |
| Steel | `#3f5774` | Informational / signature secondary |

### Dark theme — "midnight-navy" (from the icon)

| Token | Hex | Role |
| --- | --- | --- |
| Ground | `#131923` | Primary background |
| Raised | `#1b2230` | Cards, raised surfaces |
| Sunken | `#0d121a` | Recessed wells, insets |
| Ink / text | `#e9ebdb` | Primary text |
| Cat's-eye sage-gold (glow) | `#cfd4b0` | Signature **glow** accent (eyes, focus) |
| Gold (as text) | `#d9a847` | Sage-gold used as legible text |
| Steel-blue rim light | `#7d99c4` | Signature secondary, rim/edge light |
| Oxblood accent | `#e0726a` | **Primary action** in dark |
| Sage | `#8fab80` | Success / positive |

### Accent usage rules

- **Oxblood is the primary-action color** in both themes (`#8b2e2a` light, `#e0726a` dark). Reserve it for the one most important action on a surface. Don't paint whole regions oxblood.
- **The signature hues are cat's-eye sage-gold (`#cfd4b0` / `#d9a847`) and steel-blue (`#7d99c4` / `#3f5774`).** These are what make Sirius recognizable. Use sage-gold for glow/focus/highlight moments and steel-blue for informational/secondary emphasis.
- **For sage-gold or mustard as _text_, use the legible variant** (`#d9a847` dark, `#876012`/`#c89530`→`#876012` light) — the glow values are for fills and accents, not body type.
- Never introduce a hue outside this system. If you need another step, derive it within the same family.

---

## IV. Typography

Three faces, each with a job.

| Face | iOS equivalent | Role |
| --- | --- | --- |
| **Newsreader** (serif) | New York | Body and UI text |
| **Instrument Serif** (display serif) | New York (display) | Display titles, hero headlines |
| **JetBrains Mono / Geist Mono** | SF Mono | Labels, meta, captions, folios |

**Usage:**
- Body and most UI: **Newsreader.** It carries the editorial, read-it-like-a-paper feel.
- Big display moments and section titles: **Instrument Serif.**
- Labels, timestamps, metadata, captions, and the roman-folio motif: **the mono face.** Terse and quiet.
- Maintain a clear type scale (display → heading → body → caption). Don't mix more than these three families.

---

## V. The editorial rules

These are non-negotiable and what make the system feel like Sirius.

- **Zero border-radius everywhere.** `radius.none = 0`. The only exception inside the product is true pills (`pill = 999`) — and the **Apple "Download on the App Store" badge**, which keeps its own rounded corners (see §VIII).
- **Hairline rules.** Structure with **1px / 1.5px** rules, not shadows or heavy borders. The grid is ruled like a newspaper.
- **Flat surfaces.** Differentiate with the ground/raised/sunken tokens, not drop shadows or glows (except the deliberate sage-gold glow accent in dark).
- **Roman-numeral folios + mono captions.** Mark sections with I, II, III… in the mono face, paired with terse monospace captions. This is the signature marketing motif.

---

## VI. Imagery and photography direction

- **Editorial and restrained.** Think documentary stills and quiet detail shots, not stocky "happy people at laptops."
- **Night and signal.** Lean into the brand's nocturnal idea: low light, a single point of clarity, the sage-gold glow as the focal warmth.
- **Real artifacts.** Show actual captures — a link, a screenshot, a note becoming a clean post. Show the product doing its job.
- **Color discipline.** Keep imagery compatible with the paper-and-ink / midnight-navy palettes. Let oxblood and sage-gold be the only loud notes.
- **The cat is atmosphere.** When it appears, it's small, quiet, and watchful — never a cartoon.

---

## VII. Iconography

- **Line icons, hairline weight,** matching the 1px/1.5px rule system. Square corners, no rounded caps where avoidable.
- Monochrome by default (ink / muted ink); use an accent only to mark a primary action or state.
- Keep the set small and consistent. No filled, glossy, or skeuomorphic icons.

---

## VIII. Accessibility and third-party assets

- **WCAG-AA contrast for all text** is a contract, not a goal. Every text token above is specified to meet AA against its intended background. When in doubt, use the legible text variants (`#d9a847`, `#876012`) rather than the glow values.
- Don't encode meaning in color alone — pair color states with text or icon.
- Respect dynamic type / scaling; the editorial scale should reflow, not clip.

**Third-party mark — the one radius exception.** The Apple **"Download on the App Store"** badge keeps its **own rounded corners** and official styling. It is the single intentional exception to the zero-radius rule. Never restyle, recolor, or square-off the Apple badge.

**OG / App Store assets.** Generated social cards and store assets follow the same tokens and type. (Implementation note: same-origin generated PNGs are served unoptimized; OG image routes are `.tsx`.) Keep the roman-folio + mono-caption motif on marketing OG cards for brand consistency.

### Visual do / don't gallery (in words)

| Do | Don't |
| --- | --- |
| Flat cards on ruled grids, zero radius | Rounded cards with soft drop shadows |
| Sage-gold glow as a single focal accent | Sage-gold flooding an entire panel |
| Oxblood on the one primary action | Oxblood backgrounds and oxblood text everywhere |
| Three type faces, clear scale | Five fonts and inconsistent sizing |
| Mono captions + roman folios | Decorative script or all-caps shouting |
| Apple badge in its official rounded form | A squared-off, recolored "App Store" badge |

See siblings: [Brand Strategy](./00-brand-strategy.md) · [Messaging Framework](./01-messaging-framework.md) · [Naming & Nomenclature](./03-naming-nomenclature.md).
