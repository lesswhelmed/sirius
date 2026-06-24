# Mobile routes & deep links (canonical map)

The authoritative list of every screen in `apps/mobile` and the exact URL that
opens it. Keep this file in sync when you add, rename, or remove a route under
`src/app/`. **This is the file to consult before deep-linking the app** (manual
testing, agent-device, Shortcuts, share extension) so nobody burns time poking at
a path that does not exist.

## The one rule that bites everyone

**The URL scheme is `siriusapp://`.** It is declared once in `app.json`
(`expo.scheme`). The bundle identifier `dev.copt.sirius` is **NOT a URL scheme** —
it is only the id you pass to `xcrun simctl launch <udid> dev.copt.sirius` to cold-
launch the binary. Deep links must use `siriusapp://`, e.g. `siriusapp://tree`.
(If a comment somewhere shows `dev.copt.sirius://…`, that is wrong — treat
`ROUTES.md` as the source of truth.)

**Tab UI labels are NOT route names.** The bottom tab bar shows friendly labels
that differ from the underlying file/route names for 4 of the 5 tabs. The route is
the **file name**, not the label. There is **no `/explore` route** — the tab
labeled "Explore" is the `/tree` route (kept named `tree` so `/tree/[...node]`
drill links and existing deep links keep resolving). `siriusapp://explore` →
**Unmatched Route**. Use `siriusapp://tree`.

## Tabs — `src/app/(tabs)/` (label ≠ route)

| Tab label (UI) | Route / file       | Deep link             |
| -------------- | ------------------ | --------------------- |
| Capture        | `composer`         | `siriusapp://composer`|
| Catalog        | `library`          | `siriusapp://library` |
| Explore        | `tree`             | `siriusapp://tree`    |
| Account        | `settings`         | `siriusapp://settings`|

There are **4 tabs**. Every label is renamed in the layout
(`(tabs)/_layout.tsx` via `NativeTabs.Trigger.Label`) — none matches its route
name. The signed-in entry point (`/`) redirects to `/(tabs)/library` (the Catalog
tab).

**Queue is no longer a tab.** Its "in flight" status board folded into the
Catalog tab — `library.tsx` now renders pending/processing/failed submissions
(server queue + local offline outbox) in an in-flight section above the post
list, and completed items appear as normal clickable post cards. The legacy deep
link `siriusapp://queue` still resolves (back-compat) via the top-level
`app/queue.tsx`, which redirects to `/library`.

## Top-level stack routes — `src/app/`

| Route                  | File                        | Deep link / notes                                                                 |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| `/`                    | `index.tsx`                 | Entry. → `/(auth)/sign-in` if signed-out, `/help` on first run, else `/(tabs)/library`. |
| `/capture`             | `capture.tsx`               | App Intents / Shortcuts target. `siriusapp://capture?text=<encoded>` (host or first segment, see `+native-intent.ts`). |
| `/shareintent`         | `shareintent.tsx`           | Share-extension landing. NOT linked directly — `+native-intent.ts` rewrites the synthetic `mobile://dataUrl=…` share URL here. |
| `/focus`               | `focus.tsx`                 | `siriusapp://focus`                                                                |
| `/friends`             | `friends.tsx`               | `siriusapp://friends` (also pushed from Account).                                  |
| `/help`                | `help.tsx`                  | `siriusapp://help`. "How Sirius works" hub + first-run onboarding.                 |
| `/queue`               | `queue.tsx`                 | `siriusapp://queue`. Back-compat redirect → `/library` (Queue folded into Catalog; no longer a tab). |
| `/space`               | `space.tsx`                 | `siriusapp://space`. Full 3D embedding space (the Explore tab's "Map" view also lives here). |
| `/llm`                 | `llm.tsx`                   | `siriusapp://llm`. On-device model download + chat. Hidden unless `EXPO_PUBLIC_ON_DEVICE_AI=true`. |
| `/llm-test`            | `llm-test.tsx`              | `siriusapp://llm-test?run=all` (or `?run=ask`). Dev-only draft/ask bench.          |
| `/u/[handle]`          | `u/[handle]/index.tsx`      | Friend invite / profile landing. `siriusapp://u/<handle>` (normalized in `+native-intent.ts`). Index route — `u/[handle]` is a folder, not a file, so it can host the sibling `catalog` route below. When already friends it shows a "View catalog" button. |
| `/u/[handle]/catalog`  | `u/[handle]/catalog.tsx`    | A friend's catalog (their PUBLISHED + FRIENDS/PUBLIC posts). `siriusapp://u/<handle>/catalog`. Reached from a friend row on `/friends`, the author `@handle` chip in the Library "Friends" feed, or the profile's "View catalog" button. 404 (not friends / no user) → neutral "not available". |
| `/tree/[...node]`      | `tree/[...node].tsx`        | Explore drill-in. `siriusapp://tree/<node>/<child>…`                               |
| `/post/[slug]`         | `post/[slug]/index.tsx`     | `siriusapp://post/<slug>`                                                          |
| `/post/[slug]/edit`    | `post/[slug]/edit.tsx`      | `siriusapp://post/<slug>/edit`                                                     |
| `/post/local/[localId]`| `post/local/[localId].tsx`  | `siriusapp://post/local/<localId>` (offline-mirror draft).                         |

## Auth group — `src/app/(auth)/`

Routes resolve without the group prefix (`siriusapp://sign-in`, etc.):

| Route               | File                          |
| ------------------- | ----------------------------- |
| `/sign-in`          | `(auth)/sign-in.tsx`          |
| `/sign-up`          | `(auth)/sign-up.tsx`          |
| `/forgot-password`  | `(auth)/forgot-password.tsx`  |
| `/reset-password`   | `(auth)/reset-password.tsx`   |
| `/verify-pending`   | `(auth)/verify-pending.tsx`   |

## Deep-link rewriting — `src/app/+native-intent.ts`

`redirectSystemPath` runs for every incoming link before the router matches it:

- `mobile://dataUrl=<shareExtensionKey>?nonce=…` (expo-share-intent) → `/shareintent`.
- `siriusapp://capture?text=…` (App Intents; "capture" as host *or* first segment) → `/capture?…` (query forwarded verbatim).
- `siriusapp://u/<handle>` → `/u/<handle>` (and `siriusapp://u/<handle>/catalog` → `/u/<handle>/catalog`; the path after the handle is preserved).
- Anything else passes through unchanged.

## When you change routes

1. Add/rename/remove the file under `src/app/`.
2. If it's a tab, update the label in `(tabs)/_layout.tsx`.
3. Update this table **in the same change** — and double-check the label↔route
   mapping above, since that is the part that misleads people.
