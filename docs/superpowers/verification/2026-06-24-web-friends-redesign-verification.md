# Web Friends Redesign — Verification (traced proof)

**Date:** 2026-06-24
**Verifier:** EmeraldCreek (agent), driving the running web app in a real browser
**Design under test:** [`../specs/2026-06-23-web-friends-redesign-design.md`](../specs/2026-06-23-web-friends-redesign-design.md)
**Verdict:** ✅ **PASS** — all four owner-approved decisions exercised end-to-end against the live app.

## What was verified

The four decisions in the design doc, driven through the real UI (not unit tests):

1. Unify the profile into `/u/[handle]` with four viewer states (anonymous / self / signed-in non-friend / accepted friend → catalog grid).
2. Retire `/friends/[handle]` → permanent redirect to `/u/[handle]`.
3. Friends list: **Recent / A–Z** sort toggle (gated at `friends.length > 5`).
4. Friends list: real avatar `<Image>` with serif-monogram fallback.

## Method

- **App:** already-running dev stack — `https://sirius.local` (portless → `next dev` on `:3000`), confirmed `200`.
- **Driver:** headless Chromium via the `dev-browser` skill (real navigation, clicks, screenshots).
- **Accounts (local dev DB):**
  - `saleebmina@icloud.com` (handle `saleebmina`, "Mina") — used for the four `/u/[handle]` viewer states.
  - `reviewer@lesswhelmed.com` (handle `sirius-review`, "App Review") — used for the friends-list toggle/avatar checks, **after** seeding it >5 friends (see "Fixtures").
- **Surface:** GUI — observed in pixels + DOM assertions. Evidence screenshots live under
  [`assets/2026-06-24-web-friends-redesign/`](assets/2026-06-24-web-friends-redesign/).

## Fixtures (seeded through the real endpoints, not raw SQL)

To exercise the `>5` sort gate and the real-image avatar path, the reviewer account was given 7 demo
friends. These are **not** hand-written friendship rows — they are created by driving the live
friend-request flow over HTTP, so the data is byte-for-byte what real user traffic produces. This is
now a permanent part of reviewer setup:

- `scripts/create-reviewer-account.ts` → `seedFriends()`:
  1. `POST /api/auth/sign-in/email` as the reviewer,
  2. `POST /api/app/friends/requests { handle }` (reviewer → each demo friend),
  3. `POST /api/auth/sign-in/email` as each friend, then
  4. `POST /api/app/friends/requests/{reviewerId} { action: "accept" }`.
- 4 of the 7 friends carry a DiceBear initials avatar (remote URL → next/image `unoptimized` branch);
  3 are image-less (monogram fallback).
- Both endpoints carry a back-reference comment to this script (`Seeded by: …`).
- Idempotent: a second run reports `request exists, accept noop` and changes nothing.
- Run used: `bun run scripts/create-reviewer-account.ts --password '…' --no-scene --web-url http://localhost:3000`

DB after seeding (8 ACCEPTED = 7 demo + Mina), all with `acceptedAt` set and `requestedById` = reviewer:

```
     handle     | has_img |  status  | has_accepted_at | reviewer_requested
----------------+---------+----------+-----------------+--------------------
 ava-rivers     | t       | ACCEPTED | t               | t
 iris-nakamura  | f       | ACCEPTED | t               | t
 leo-marsh      | t       | ACCEPTED | t               | t
 mira-quinn     | t       | ACCEPTED | t               | t
 noah-fields    | t       | ACCEPTED | t               | t
 sana-okafor    | f       | ACCEPTED | t               | t
 theo-lindqvist | f       | ACCEPTED | t               | t
```

## Steps

Each step is one action against the **running app** and what it showed.

### Decision 1 — `/u/[handle]` four viewer states

1. ✅ **Self** — signed in as Mina, visited `/u/saleebmina`. Rendered the invite branch with
   `Your invite link` + "This is your own invite link. Share it with friends…".
   → `assets/…/01-self.png`

2. ✅ **Accepted friend (with shared posts)** — visited `/u/meowinas` (Mina ↔ Meowinas are friends;
   Meowinas has 1 `FRIENDS` published post). Rendered the **catalog branch**: `Catalog · @meowinas`,
   `Meowinas.`, `Friends ✓`, `1 shared`, and the post card "The Morning Inspection".
   This proves `listFriendCatalog` is used (not the invite card) and is scoped correctly.
   → `assets/…/02-friend-catalog.png`

3. ✅ **Accepted friend (no shared posts)** — visited `/u/sirius-review` (friends, but only `PRIVATE`
   posts). Rendered `0 shared` + "App Review hasn't shared anything yet." — i.e. `PRIVATE` posts are
   correctly excluded by `listFriendCatalog` (`FRIENDS|PUBLIC` only). → `assets/…/03-friend-empty.png`

4. ✅ **Signed-in non-friend** — visited `/u/sirius-review-w` (not friends). Rendered `Add a friend ·
   @sirius-review-w` + the `Add friend` button (`AddFriendButton`). → `assets/…/04-nonfriend.png`

5. ✅ **Anonymous** — cleared cookies, visited `/u/saleebmina`. Rendered the invite card + `Get Sirius`
   + `Sign in to add me`. → `assets/…/05-anonymous.png`

### Decision 2 — `/friends/[handle]` retired to a redirect

6. ✅ Navigated to `/friends/meowinas`. Browser **final URL was `/u/meowinas`** and the page showed the
   friend catalog — the legacy route now permanently redirects into the unified profile.

### Decision 3 — Recent / A–Z sort (gated at `>5`)

7. ✅ As **Mina** (2 friends), `/friends` showed **no** sort toolbar — `aria-label="Sort friends"` and
   `aria-label="Filter friends"` both absent. Gate correctly hidden below the threshold.

8. ✅ As the **reviewer** (8 friends), `/friends` showed the toolbar — both `Sort friends` and
   `Filter friends` present. → `assets/…/06-friends-recent.png`

9. ✅ Clicked **A–Z**. The list reordered and **exactly equals `localeCompare(recent)`**:

   ```
   RECENT : Iris Nakamura, Theo Lindqvist, Sana Okafor, Leo Marsh, Mira Quinn, Noah Fields, Ava Rivers, Mina   (acceptedAt desc)
   A–Z    : Ava Rivers, Iris Nakamura, Leo Marsh, Mina, Mira Quinn, Noah Fields, Sana Okafor, Theo Lindqvist   (== localeCompare(recent))
   ```
   → `assets/…/07-friends-az.png`

10. ✅ Clicked **Recent** again → list restored to the original `acceptedAt desc` server order
    (confirms "alpha sorts a copy; underlying order preserved").

### Decision 4 — real avatar images + monogram fallback

11. ✅ Reviewer's `/friends` rendered **4 `<img>` avatars** (the image-bearing friends) and **monograms**
    for the 3 image-less friends ("I", "T", "S" + "M" for Mina). The 4 images loaded real pixels
    (`naturalWidth/Height = 128`, `complete: true`) via the DiceBear remote URLs through the next/image
    `unoptimized` branch:

    ```
    https://api.dicebear.com/9.x/initials/png?seed=Leo%20Marsh…   128×128 complete
    https://api.dicebear.com/9.x/initials/png?seed=Mira%20Quinn…  128×128 complete
    https://api.dicebear.com/9.x/initials/png?seed=Noah%20Fields… 128×128 complete
    https://api.dicebear.com/9.x/initials/png?seed=Ava%20Rivers…  128×128 complete
    ```

### Probe — filter field (adjacent affordance)

12. 🔍 Typed `ri` into the filter → list narrowed to `Iris Nakamura` + `Ava Rivers` (both contain "ri").
    Filter matches on name (and handle) as designed. → `assets/…/08-friends-filter.png`

## Findings

- ⚠️ **Avatar source is an external CDN (DiceBear).** The 4 seeded avatars point at
  `api.dicebear.com`. The component degrades to the monogram on load error, so a CDN outage is
  non-fatal, but the App-Store-review demo depends on DiceBear being reachable. If that's not
  acceptable, swap the seed URLs for self-hosted assets. (Left external pending owner confirmation.)
- The friends step needs a **known reviewer password** to sign in — on a re-run of an existing
  account *without* `--password` it is skipped with a clear notice (it does not fail the whole seed).
  Surfaced and fixed during verification: `ensureReviewerUser` returns `null` for a *supplied*
  password (it only echoes a *generated* one), so `main()` now falls back to `args.password`.
- The reviewer is also friends with "Mina" (a pre-existing local friendship), so the local reviewer
  shows 8 friends; a clean prod seed shows the 7 demo friends.
- No automated test runner exists in this repo (per `CLAUDE.md`), so this manual, screenshot-backed
  run is the verification of record.

## Reproduce

```sh
# 1. dev stack up (serves https://sirius.local → :3000)
bun run dev            # run interactively; see CLAUDE.md portless note

# 2. seed the reviewer's friends through the real endpoints (idempotent)
bun run scripts/create-reviewer-account.ts --password '<known-pwd>' --no-scene --web-url http://localhost:3000

# 3. sign in as reviewer@lesswhelmed.com and open /friends → toolbar + avatars;
#    open /u/<a-friend-handle> for the catalog branch.
```
