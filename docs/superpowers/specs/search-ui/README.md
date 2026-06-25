# Curated Search — UI design reference

Shared visual contract for the web (`/catalog`) and mobile (library tab) curated
search surfaces. The components were designed with Stitch (UX) and v0 (React
component), then adapted into each host's existing token system.

## Stitch — UX design

- **Project:** `Sirius Curated Search` — `projects/9858253257995730989`
- **Screen:** `Curated Search Results` — screen id `2ad83a50488c44e197d7029b85971d37`
  (desktop), status COMPLETE.
- **Design system produced:** "The Editorial Archive" — cream paper (`#F9F7F2`),
  oxblood accent (`#800000`), Playfair Display (serif display-italic), Source
  Serif 4 (body), JetBrains Mono (tracked-out uppercase micro-labels), sharp 0px
  corners, hairline rules, no shadows. This independently converged on the app's
  existing editorial aesthetic, which validated the direction.
- **Badges:** EXACT = solid oxblood fill, cream text; SIMILAR = 1px oxblood
  outline, oxblood text. Carried through to both implementations.

## v0 — React component

- **Chat:** https://v0.app/chat/tlNBIvb24rw  (chat id `tlNBIvb24rw`)
- Generated a single-file `CuratedSearch` (`{ value, onChange, items, isLoading,
  partial }`) with: serif-italic field between two ink rules, hairline-divided
  result rows (mono type label, serif-italic title, 2-line snippet, category
  pill + `#tag` chips), contrasted EXACT (solid) / SIMILAR (ghost) badges,
  skeleton/empty/idle states, and a dashed "Similar matches unavailable" note for
  the `partial` flag.

## Adaptation (what shipped)

The v0 output invented its own tokens (`--color-ink`, `--color-cream`). Both
shipped components keep its **structure and badge design** but use each host's
real tokens:

- **Web:** `apps/web/app/(public)/catalog/curated-search.tsx` — app tokens
  (`--color-accent`, `--fg*`, `--color-rule*`, `font-display`/`font-mono`),
  imports `SearchHit`/`SearchPage` from `@repo/db`, adds the debounced abortable
  fetch against `/api/app/search`. Mounted in `owner-catalog.tsx` under the
  header; empty field ⇒ the existing browse catalog stays the default view.
- **Mobile:** `apps/mobile/src/components/corpus-search.tsx` — mobile theme
  tokens (`t.color.*`, `t.font.*`), React Query fetch, rows link to
  `/post/${slug}`. Pinned search field + conditional results in
  `apps/mobile/src/app/(tabs)/library.tsx`; online-only (the local SQLite mirror
  can't serve friends'/public hits).

Both render the SAME `SearchHit` shape returned by `/api/app/search`
(`@repo/db searchCorpus`), so the two hosts can't disagree on results.
