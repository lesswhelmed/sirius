# Fold Queue into Catalog + link in-flight items to their post

Date: 2026-06-24
Status: Approved (user said "BUILD IT")

## Problem

The Queue page (web `/queue`, mobile Queue tab) is a read-only status board with
**no way to click through** to the post an item produced. It feels like a
dead-end. The owner has to go to Catalog separately to find the resulting post.

## Decision

Remove Queue as a standalone destination. Fold "in-flight" status **into the
Catalog** as a section pinned at the top, above the post list. Items show as
queued/processing until they resolve into a real post **in place**. Failures show
as inline error cards. This unifies "queued → post" into one place and makes the
submission→post relationship a natural transition rather than a manual hunt.

The submission→post link already exists in the data: every completed
`IngestSubmission` carries `resultPostId` (FK) + `resultPostSlug`. **No DB or API
changes are needed.** The work is entirely UI + IA.

## In-flight section semantics (both platforms)

The section lists only **non-terminal / needs-attention** submissions:

- `pending` / `processing` → status glyph/pip + label. Not tappable (no post yet).
- `failed` → inline **error card** showing the error message. **Read-only** —
  web has no retry today and we are NOT adding a server retry/discard API.
- `completed` → leaves the in-flight section; the post appears in the list below
  as a normal, clickable card. That card IS the link to the created post.
- Empty in-flight set → section hidden entirely (Catalog looks like today).

## Web (`apps/web`)

- **New client island** `app/(public)/catalog/in-flight.tsx` ("use client"):
  polls `GET /api/app/queue?limit=50` every 3s (same cadence as the old
  `live.tsx`), renders the in-flight rows (pending/processing/failed). Reuses the
  status glyph/label/tone maps + `primaryLabel` (move them out of `live.tsx` into
  the new file). On detecting a row transition into `completed`, call
  `router.refresh()` so the server-rendered post list re-fetches and the new post
  appears in place.
- **`owner-catalog.tsx`**: render `<InFlight />` just under the header, above the
  two-zone list layout (only in the `mine` scope, not the friends feed). Pass the
  `projectTitles` map (already fetched on the old queue page via
  `listProjectTitles`) so completed→project annotation can render if kept; or
  drop the project annotation to keep the island self-contained — implementer's
  call, keep it simple.
- **`app/(app)/queue/page.tsx`**: replace body with `redirect("/catalog")` for
  back-compat (bookmarks/links don't 404). Delete `app/(app)/queue/live.tsx`
  (its reusable bits moved to `in-flight.tsx`).
- **`app/_chrome/site-nav.tsx`**: remove the `/queue` `Queue` nav item from
  `SIGNED_IN_NAV`. (Folios are cosmetic Roman numerals; re-lettering the rest is
  optional polish, not required.)

## Mobile (`apps/mobile`)

- **`src/app/(tabs)/library.tsx`** (the Catalog tab): add an **in-flight header
  section** above the post list, inside the existing `ListHeaderComponent`. It
  reuses the two data sources from `queue.tsx`:
  1. server queue — `useQuery(["queue"], () => apiGet("/api/app/queue?limit=50"))`
     with `refetchInterval`, filtered to pending/processing/failed.
  2. local offline outbox — the `useLiveQuery` over `pendingSubmissions`
     (queued/in_flight/failed), with the existing **Send now** (`kickSync`),
     **Requeue** (`requeueSubmission`), **Discard** (`discardSubmission`) actions.
  Completed server submissions are NOT shown here — they arrive as synced posts in
  the mirror list, already tappable → `/post/[slug]`.
- **`src/app/(tabs)/_layout.tsx`**: remove the `queue` `NativeTabs.Trigger`
  (5 tabs → 4: Capture, Catalog, Explore, Account).
- **`src/app/(tabs)/queue.tsx`**: retire the screen. Keep `siriusapp://queue`
  resolving (back-compat) by converting it to a `<Redirect href="/library" />`
  (or the equivalent that compiles cleanly with native tabs); do not leave a
  dead/in-tab screen.
- **`apps/mobile/docs/ROUTES.md`**: update to reflect Queue is gone as a tab and
  `siriusapp://queue` now redirects to the Catalog tab.

## Out of scope (explicitly)

- No server-side retry/discard API (web stays read-only for server failures).
- No DB/schema/API changes.
- No new shared package; keep per-platform rendering (web HTML vs RN). Only the
  tiny web status-map move within `apps/web` is allowed.

## Constraints (repo-specific)

- Mobile: do NOT touch `apps/mobile/src/components/sirius.tsx` (pre-existing
  uncommitted change) or run any git commands. Edit only the named files.
- Web: no `export const dynamic`/`runtime` (Cache Components forbids it); the
  catalog page is already dynamic via session reads.
- Do not commit; the user will review the working tree.

## Revision 2 (2026-06-24) — collapsible strip + dismissable failures

After shipping v1, the always-expanded in-flight stack felt heavy above the
catalog, and failed items piled up with no way to clear them. Redesigned (Stitch
mockup in project 9980782539670641675):

- **Collapsed by default:** the in-flight area becomes a single hairline strip —
  live dot + terse summary (`In flight — 1 processing · 2 failed`) + chevron.
  Hidden entirely when nothing is in flight.
- **Expandable:** chevron reveals a tight inline list of items. Processing rows
  show a subtle progress glyph (no actions); failed rows get a `×` dismiss on the
  right + a faint "Dismiss all" link.
- **New backend (the real pile-up fix):**
  - `dismissSubmission(submittedById, id): Promise<number>` in
    `packages/db/src/ingest.ts` — `deleteMany` guarded by `submittedById` AND
    `status in (failed, skipped)`, returns deleted count. Re-export from
    `packages/db/src/index.ts`. Hard delete is safe: failed rows have no post and
    already dropped staged bytes (retention is success-only).
  - `DELETE /api/app/queue/[id]/route.ts` — session-authed; 401 no session,
    404 when `dismissSubmission` returns 0 (not owned / wrong status), 204 on
    success.
- **Web** (`catalog/in-flight.tsx`): collapsed/expandable strip; `×`/"Dismiss
  all" call the DELETE endpoint then drop the row from local state (and stop
  showing it). Keep the existing poll + `router.refresh()`-on-complete behavior.
- **Mobile** (`library.tsx` in-flight section): collapsible summary row; server
  failed rows get a Discard wired to the DELETE endpoint (then refetch the
  `["queue"]` query). The local-outbox Discard stays as-is.

## Verification (manual — no test runner in repo)

`bun run check-types` + `bun run lint` (filtered to web + mobile) must pass.
Then, manually: enqueue a submission, confirm it shows in the Catalog in-flight
section (web + mobile), resolves into a post in place on completion, the post is
clickable, and a failed item shows its error inline.
