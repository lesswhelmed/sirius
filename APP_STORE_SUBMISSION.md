# Sirius — App Store Submission Guide

Everything you need to ship **Sirius** (iOS) to the App Store, written for top-to-bottom
execution. Versions are pinned to what's actually in this repo as of **2026-06-22**.

> **Good news up front:** the technical pipeline is already done. The App Store Connect
> app record exists (`ascAppId 6775729513`), credentials are valid, and at least one
> **FINISHED production build (v1.0.0)** has shipped. Confirm the latest with
> `cd apps/mobile && bunx eas-cli build:list --platform ios --limit 5`. What remains is
> mostly content: privacy/support pages (drafted in this repo — deploy them), listing copy
> (drafted below), screenshots (captured into `app-store-assets/`), a reviewer account,
> and the App Store Connect form-filling + "Submit for Review".

---

## 0. Resubmission — rejection 2c02b4c2 (2026-07-03) — UGC safety (1.2) + age rating (2.3.6)

**Current blocker.** Submission `2c02b4c2-41ec-448f-9161-9aae12e12fbe`, v1.0 (**build 72**),
reviewed 2026-07-03 on iPad Air 11" (M3), rejected for **two issues that share one root
cause: the Friends feed shipped**, so Sirius now has user-generated content that other
users can see. The subscription issues from §0b were **not raised again** — treat them as
resolved, and don't disturb the paywall/links work that fixed them.

> **Note:** build **73** already exists (FINISHED 2026-07-02, commit `948b191`) but contains
> none of the fixes below — a **new build is required** after Parts A–D land.

- **Guideline 1.2 — Safety, UGC.** Apps with UGC must have **all four**: (a) terms (EULA)
  users must **agree to**, with explicit **zero tolerance** for objectionable content and
  abusive users; (b) a mechanism to **flag objectionable content**; (c) a mechanism to
  **block abusive users** — blocking must **notify the developer** and remove the blocked
  user's content from the feed **instantly**; (d) the developer must **act on reports
  within 24 hours** (remove the content, eject the offending user).
- **Guideline 2.3.6 — Accurate metadata.** Age Rating must answer **"Yes"** to
  **User-Generated Content** (App Store Connect config only, no code).

**Why this happened.** The age-rating guidance further down this doc answered "No" to UGC
because posts were private-per-account — true at build 58, false since the Friends hub +
shared feed shipped (`docs/friends-feed.md`): friends' FRIENDS/GROUP/PUBLIC posts render
cross-user in the Friends tab via `GET /api/app/feed`. Apple is right; the fix is to add
the missing safety mechanics (and fix the rating answer), not to hide the feed.

### What exists today (audited 2026-07-03 — reuse these seams)

- **Proactive safety gate (cite it in the reply, it exceeds baseline):** the worker's
  Gemini content gate (`docs/safety-guardrails.md`, `apps/worker/src/pipeline/safety/`)
  scans every capture **before** a post exists; flagged material never becomes a post —
  quarantine + `ModerationEvent` row + admin email via `@repo/auth/email` (Resend,
  `SAFETY_ALERT_EMAIL` → `saleebmina@copt.dev`). Apple still requires the four *reactive*
  mechanisms above — pre-moderation alone doesn't satisfy 1.2.
- **better-auth `admin()` plugin is registered** (`packages/auth/src/index.ts`) and its
  columns (`role`, `banned`, `banReason`, `banExpires`) already exist on `user` — but
  nothing calls it. `banUser` (revokes sessions + blocks sign-in) is the ready-made
  "eject the user" primitive.
- **`FriendshipStatus.BLOCKED` is reserved but unused** — and the friendship row is
  *symmetric* (one canonical row per pair), so it cannot express "A blocked B" direction.
  **Do not reuse it**; add a directional `UserBlock` model (Part C).
- **The feed + peers' post detail are live/network-only** (never in the mobile offline
  mirror — `apps/mobile/src/components/friends-feed-list.tsx` fetches
  `/api/app/feed` fresh; `post/[slug]` mirror rows are always the owner's own). A
  server-side block exclusion therefore takes effect **instantly** — exactly what 1.2 asks.
- **Missing entirely:** a `/terms` page, any terms-agreement in sign-up/sign-in, any
  report/flag model/route/UI, any block mechanism, any admin surface (`/api/admin` doesn't
  exist; no code calls admin APIs).

### Part A — Terms of Use (EULA) agreed before registering or logging in

1. **New page `apps/web/app/(public)/terms/page.tsx`** → `https://lesswhelmed.com/terms`.
   Match the privacy page's pattern (server component, `metadata`, `LAST_UPDATED`
   constant, local `Section` helper, `(public)` layout chrome). Required content:
   - **Zero-tolerance clause, verbatim-strength:** "There is no tolerance for
     objectionable content or abusive behavior on Sirius. Content or accounts that
     violate these terms will be removed and offending users ejected." (Apple's reviewers
     look for this exact commitment.)
   - Acceptable-use / content standards (no illegal, hateful, harassing, sexually
     explicit, violent, or infringing content), enforcement (reports reviewed and acted
     on **within 24 hours**: content removed, repeat/serious offenders banned),
     account termination, plus standard license/disclaimer boilerplate. Note that the
     iOS app is additionally licensed under Apple's standard EULA.
2. **Sign-up: required agreement checkbox (both platforms).**
   - Mobile `apps/mobile/src/app/(auth)/sign-up.tsx`: a checkbox row between the Password
     `AuthField` and the `PrimaryButton` — "I agree to the **Terms of Use** and
     **Privacy Policy**" with both links opening via `expo-web-browser`
     `openBrowserAsync` (same pattern as `subscription-section.tsx`). Submit stays
     disabled until checked. (No checkbox exists in `@/components/sirius` yet — add a
     small `AgreeRow`/checkbox there.)
   - Web `apps/web/app/(auth)/sign-up/page.tsx`: same — a checkbox `styles.field` row
     after Password, before the submit button, links to `/terms` + `/privacy`.
3. **Sign-in path (Apple said "before registering **or logging in**").**
   - Add a one-line notice + links on the sign-in screens (mobile + web): "By signing
     in you agree to the Terms of Use."
   - **One-time acceptance gate for existing accounts:** stamp acceptance server-side —
     `termsAcceptedAt DateTime?` on `User` (+ `termsVersion String?` if we ever revise),
     surfaced via better-auth `user.additionalFields` (`input: false`, set server-side).
     Sign-up sets it at registration; for any session where it's `null` (i.e. the
     existing **reviewer demo account** — the reviewer signs *in*, not up), show a
     one-time blocking "Agree to the Terms" screen that POSTs
     `/api/app/account/accept-terms`. This guarantees the reviewer *sees* an agreement
     gate no matter which path they take, and covers all pre-existing users.
4. **Link swaps (decision — see "Decisions needed"):** point the in-app Terms links at
   our own terms: `TERMS_URL` in `apps/mobile/src/components/subscription-section.tsx`
   → `https://lesswhelmed.com/terms`, the RevenueCat paywall footer Terms link, and the
   App Description EULA line (§7). `/terms` itself references Apple's standard EULA, so
   the 3.1.2(c) compliance from §0b is preserved.

### Part B — Flag objectionable content

1. **Schema (`packages/db/prisma/schema.prisma`):** new `ContentReport` model —
   `id`, `postId` (FK → Post, `onDelete: Cascade`), `reporterId` (FK → User),
   `reason` (enum: `OBJECTIONABLE | ABUSE | SPAM | OTHER`), `note String?`,
   `status` (`open | resolved`), `createdAt`, `resolvedAt`, `resolvedById`,
   `resolution String?`; index on `[status, createdAt]`. New helpers in
   `packages/db/src/moderation.ts` (`createContentReport`, `listOpenReports`,
   `resolveReport`), re-exported from `src/index.ts`. Prisma migration required.
2. **API:** `POST /api/app/posts/[slug]/report` (session-authed) — validate the viewer
   can read the post (`canReadPost`), create the report, and **email the admin
   immediately** (new `sendModerationAlert` modeled on the worker's `sendSafetyAlert`,
   using `renderEmail`/`sendEmail` from `@repo/auth/email` + `SAFETY_ALERT_EMAIL`) with
   post slug/title/author + reporter + reason. Idempotent per (post, reporter).
3. **UI — mobile:** an overflow ("…") action on peers' content, opening a native
   `ActionSheetIOS`/`Alert` (NOT the `Sheet` component — one-visible-Modal guard) with
   "Report post" and "Block @handle":
   - Feed rows: `apps/mobile/src/components/friends-feed-list.tsx` `renderItem`.
   - Peer post detail: `apps/mobile/src/app/post/[slug]/index.tsx` — the server-only
     branch (`!localRow`) is exactly the "someone else's post" case.
   - Friend catalog: `apps/mobile/src/app/u/[handle]/catalog.tsx`.
   On submit show a confirmation: "Reported. We review reports within 24 hours."
4. **UI — web:** a kebab menu on `CatalogCard` (`apps/web/app/(public)/catalog/
   catalog-card.tsx`) rendered only when `showAuthor` (peer posts — the Friends feed
   passes it), and a Report/Block control on `posts/[slug]` post detail when the viewer
   isn't the owner (mirror `delete-post-button.tsx`'s client-button pattern).

### Part C — Block abusive users

1. **Schema:** new **directional** `UserBlock` model — `blockerId`, `blockedId` (both
   FK → User, `onDelete: Cascade`), `createdAt`, `@@unique([blockerId, blockedId])`.
   Helpers in `packages/db/src/moderation.ts`: `blockUser`, `unblockUser`,
   `listBlockedIds(viewerId)` (returns the union of both directions — bidirectional
   invisibility is standard and cheap).
2. **Block action = one transaction + one email:** create `UserBlock`, run the existing
   `removeFriend` cascade (deletes the friendship + both parties' share-group
   memberships — `packages/db/src/friends.ts:164`), then `sendModerationAlert` —
   Apple explicitly requires **blocking to notify the developer** of the inappropriate
   content; include the blocked user + the post that prompted it (thread the post slug
   through the block UI).
3. **Enforcement — thread `blockedIds` everywhere visibility is computed** (the explorer
   found the predicate duplicated in three places; a block filter must land in **all**
   of them to avoid drift):
   - `visibilityWhereForViewer` / `listVisibleToViewer` (`packages/db/src/posts.ts`) —
     add `{ NOT: { submittedById: { in: blockedIds } } }`, param threaded like
     `friendIds`. Feeds both web `/friends` and `GET /api/app/feed` → **instant removal
     from the feed** (it's live/network-only on mobile — no mirror migration needed).
   - `searchVisibilityWhere` + the inline raw-SQL copy in `fullTextLeg`
     (`packages/db/src/search.ts`).
   - `listVisiblePostEmbeddings` (`packages/db/src/embeddings.ts`) — the embedding leg.
   - `listFriendCatalog` route + `sendFriendRequest` (refuse when a `UserBlock` exists
     in either direction — today it only checks the unused `BLOCKED` enum).
4. **API:** `POST /api/app/users/[id]/block` (body: optional `postSlug` context),
   `DELETE /api/app/users/[id]/block` (unblock), `GET /api/app/blocks`.
5. **Manage-blocks UI (small but expected by reviewers):** a "Blocked users" list with
   Unblock in mobile Account (`settings.tsx`) and web `/settings`.

### Part D — Act within 24 hours (developer tooling)

Reports and blocks already email `SAFETY_ALERT_EMAIL` in real time (Parts B/C) — the 24h
clock starts with working notification. Minimal action tooling (no new attack surface;
an admin web UI can come later):

- **`scripts/moderation/resolve-report.ts`** (bun CLI, mirrors
  `scripts/create-reviewer-account.ts` conventions): `--list` open reports;
  `--takedown <postSlug>` (set the post `PRIVATE` — removes it from every feed —
  or `--delete` for full removal incl. retained files, reusing the post-delete path);
  `--ban <userId|handle> --reason '…'` → better-auth `admin.banUser` (revokes sessions,
  blocks sign-in) + optionally mass-set the user's shared posts to `PRIVATE`;
  `--resolve <reportId> --resolution uphold|overturn`.
- Add a line to the support page FAQ: objectionable-content reports are reviewed and
  acted on within 24 hours (matches the terms).

### Part E — App Store Connect config (Guideline 2.3.6)

- [ ] App Information → **Age Rating → Edit** → set **User-Generated Content: Yes**.
  Answer any follow-on moderation questions truthfully **after Parts A–C ship** (there
  IS a report mechanism, a block mechanism, and required terms). The computed rating may
  rise above 4+ (e.g. 13+ under the updated rating system) — that's expected; accept it.
  The stale "answer No" guidance in the "Age rating questionnaire" section below has been
  corrected.
- [ ] §7 listing copy: keep "Private by default", but stop implying no sharing exists —
  the description's "PRIVATE BY DEFAULT" block and the App Review notes (§12) now
  mention the Friends feed. Update the description's Terms link per Part A.4.

### Part F — Evidence Apple asked for (reply + recording)

Apple wants **one screen recording, captured on a physical device**, attached in App
Review Information → Notes AND referenced in the Resolution Center reply, showing:

1. the terms agreement presented before registering or logging in (show sign-up with the
   required checkbox → tap the Terms link so the zero-tolerance page is visible),
2. flagging a post from the Friends feed (report flow + confirmation),
3. blocking a user and their content **disappearing from the feed instantly**.

Practical notes: the reviewer seed (`bun run reviewer:seed` + the friends seeder — see
`scripts/create-reviewer-account.ts`) already gives the demo account >5 friends with
shared posts, so the feed is populated for both the recording and Apple's own testing.
**Re-run it against prod after deploying**, and reset `termsAcceptedAt` on the reviewer
account so Apple hits the one-time acceptance gate on sign-in. Reply template is in §12
("Reply to App Review — UGC resubmission").

### Decisions needed (answer before implementation)

1. **Terms link target** — recommended: swap all Terms links (subscription card,
   RevenueCat footer, App Description) to our own `/terms` (which references Apple's
   standard EULA). Alternative: keep the Apple std EULA links for subscriptions and add
   `/terms` only for the sign-up agreement. Both pass; one link target is simpler.
2. **Takedown default** — recommended: `--takedown` sets the post `PRIVATE` (reversible,
   evidence preserved, gone from every feed); `--delete` reserved for illegal content.
3. **Report auto-hide** — optional extra: hide a reported post from the *reporter's* feed
   immediately (needs one more exclusion set). Not required by 1.2 (blocking covers
   instant removal); recommended to **skip** for this resubmission.
4. **Admin web UI** — skip for now (CLI + email meets the 24h bar); build later if report
   volume warrants.

### Resubmit checklist

- [x] Part A: `/terms` page + sign-up checkboxes (mobile/web) + sign-in notices +
  `termsAcceptedAt` (stamped by a better-auth `user.create.after` hook; sign-up UIs gate on
  an explicit checkbox) + one-time acceptance gate (web `(app)/layout.tsx` TermsGate; mobile
  `(tabs)/_layout.tsx` full-screen gate with cookie-cache-proof latch) — link swaps to
  `/terms` done in the Settings subscription card copy? **NO — subscription-card
  `TERMS_URL` + RevenueCat footer + App Description still point at Apple's std EULA;
  swap when doing Part E** (decision 1)
- [x] Part B: `ContentReport` + `POST /api/app/posts/[slug]/report` + admin alert email
  (`SAFETY_ALERT_EMAIL`) + report UI (web kebab/post-detail; mobile action sheets on feed,
  post detail, friend catalog). Re-reports REOPEN resolved reports.
- [x] Part C: `UserBlock` + `POST|DELETE /api/app/users/[id]/block` (id-first, handle
  fallback) + `GET /api/app/blocks` + enforcement in ALL visibility legs (posts, search FTS
  raw SQL, embeddings — NULL-safe) + blocked-users management (web settings, mobile Account)
- [x] Part D: `scripts/moderation/resolve-report.ts` (`--list/--takedown/--delete/--ban/
  --unban/--resolve`, fixture-smoked) + support-page report/block FAQ (24h)
- [x] Prisma migration `20260703103525_ugc_moderation` (hand-authored; applied to local dev
  + test DB; prod applies via deploy's `db:migrate:deploy`)
- [x] Reviewer seed: re-seed nulls the reviewer's `termsAcceptedAt` by default
  (`--keep-terms` opts out) so App Review always sees the acceptance gate
- [ ] `bun run deploy` (web + worker) so `/terms`, the report/block APIs, and enforcement
  are live **before** the binary is reviewed
- [ ] Re-seed the reviewer account + friends on prod; reset its `termsAcceptedAt`
- [ ] ASC: Age Rating → **User-Generated Content: Yes** (Part E)
- [ ] New iOS build + submit (`cd apps/mobile && bunx eas-cli build --profile production
  --platform ios` → `bunx eas-cli submit --profile production --platform ios --latest`)
- [ ] Physical-device screen recording (Part F) → App Review Information → Notes
- [ ] Reply in Resolution Center with **§12 → "Reply to App Review (UGC resubmission)"**

---

## 0b. Resubmission — rejection d1343e4d (2026-06-28) — subscriptions / IAP

**Resolved — not raised again in the 2026-07-03 review (build 72).** Kept for the record;
don't disturb the paywall links/metadata that fixed it. Submission
`d1343e4d-28c1-4c29-9e0d-afde0c218059`, v1.0 (build 66),
reviewed on iPad Air 11" M3 + iPhone 17 Pro Max, rejected for **two** subscription issues.
Most of the fix is **App Store Connect + RevenueCat dashboard config** (no repo code), plus
one optional code change. A **new binary is required regardless** (Guideline 2.1(b) wants the
IAP submitted *with* a build).

**What we have today:**

- Subscription = **"Sirius AI Pro"**, sold via **RevenueCat** (`react-native-purchases` +
  `react-native-purchases-ui`). Native paywall shown by `presentPaywall()`
  (`apps/mobile/src/lib/purchases/`), surfaced from the Settings "Subscription" section
  (`apps/mobile/src/components/subscription-section.tsx`).
- Privacy Policy page **exists** → `https://lesswhelmed.com/privacy`.
- **No Terms of Use / EULA page** in the repo — and **decision made: use Apple's standard
  EULA** (`https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`). No web page
  to write.
- The mobile app currently shows **no Privacy or Terms links** anywhere (paywall, Settings,
  sign-up).

### Issue 1 — Guideline 2.1(b): the IAP product wasn't submitted with the binary

The "Sirius AI Pro" auto-renewable subscription exists (RevenueCat points at it) but was never
attached to the version / submitted for review. **App Store Connect only, no code:**

- [ ] App Store Connect → app → **Subscriptions** → "Sirius AI Pro": complete metadata —
  localized display name, description, **price**, and a **subscription review screenshot**
  (mandatory; the IAP can't be submitted without it).
- [ ] Move the subscription to **"Ready to Submit"** and **attach it to the app version** so
  it is submitted **together with** the new binary. (A first subscription must ride along with
  a binary submission — exactly what Apple is asking for.)

### Issue 2 — Guideline 3.1.2(c): required subscription disclosures missing

**Part A — inside the app (the purchase flow).** Must show title, length, price (+ price-per-
unit if relevant) **and functional links to Privacy Policy and Terms of Use (EULA)**. Title /
length / price come from the products automatically; the real gap is the **two links**.

- [ ] **RevenueCat dashboard** → paywall editor for the current offering → enable the footer
  **Terms & Privacy** links:
  - Privacy → `https://lesswhelmed.com/privacy`
  - Terms (EULA) → `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`
  - This makes the **in-app** links functional with no app-code change (the RevenueCat-hosted
    paywall is remote-configured). You're shipping a new binary for Issue 1 anyway.
- [x] *(Optional, belt-and-suspenders)* **DONE** — added always-visible **Privacy Policy** +
  **Terms of Use** links at the bottom of the Settings Subscription card
  (`apps/mobile/src/components/subscription-section.tsx`), opening via
  `expo-web-browser`'s `openBrowserAsync` (Privacy → `/privacy`, Terms → Apple standard EULA).
  Ungated (always render). Typecheck + lint pass. Ships in the next binary; strengthens the
  screen recording. Independent of the RevenueCat paywall footer links.

**Part B — App Store metadata.**

- [ ] **Privacy Policy** field in App Store Connect → confirm `https://lesswhelmed.com/privacy`.
- [ ] **App Description** → add a line with both links (standard-EULA path requires the EULA
  link in the description):
  - Privacy: `https://lesswhelmed.com/privacy`
  - Terms (EULA): `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`

### Note — the IAP review screenshot vs. the screen recording (don't conflate them)

Two different artifacts satisfy two different guidelines. Get this wrong and you waste time
fighting the RevenueCat dashboard.

- **IAP "review screenshot"** (App Store Connect → the subscription product) → unblocks
  **2.1(b)**. It is **mandatory** (you can't submit the IAP without it), but its only job is to
  show the reviewer *what the purchase screen looks like*. It does **NOT** need to show the
  Privacy/Terms footer. A clean shot of the paywall (title, price, Upgrade button) is fine.
- **Screen recording** (your reply in Resolution Center) → proves **3.1.2(c)**. Apple verifies
  the Privacy + Terms links against the **running app**, not a static image — that's why they
  ask for a *recording* showing you tapping each link and it opening.

**RevenueCat's "generate screenshot" omits the footer — that's expected.** The dashboard
generator renders the template preview and doesn't draw runtime-only chrome (the footer links
render when the paywall is actually `presentPaywall()`'d on a device). So:

- **Don't** rely on the dashboard generator to prove the footer. Showing the footer in the IAP
  review screenshot is **not required** — upload whatever clean paywall image you have to
  unblock 2.1(b).
- **Best path:** capture the paywall from the **running app on the iOS Simulator** instead. One
  real capture (a) works as the App Store Connect IAP review screenshot, (b) includes the
  footer naturally (it's the real presented paywall), and (c) the same flow recorded becomes the
  3.1.2(c) screen recording — one capture, three needs.
- Regardless of the RevenueCat footer, the native Privacy/Terms links we added to the Settings
  subscription card (Issue 2A) render independently, so the in-app disclosure is unambiguous
  even if the footer is flaky.

### Resubmit checklist

- [ ] Configure the RevenueCat paywall footer links (Issue 2A).
- [ ] *(Optional)* add the links to `subscription-section.tsx`.
- [ ] Complete the subscription metadata + review screenshot, set "Ready to Submit", attach to
  the version (Issue 1).
- [ ] Add the Privacy + EULA links to the **App Description**; confirm the Privacy Policy field
  (Issue 2B).
- [ ] **New iOS build + submit** (`cd apps/mobile && bunx eas-cli build --profile production
  --platform ios` → `bunx eas-cli submit --profile production --platform ios --latest`).
- [ ] **Record the paywall** on device showing title / length / price + both functional links;
  attach it to the reply and note it in **App Review Information → Notes** (Apple explicitly
  asked for this).
- [ ] Reply in Resolution Center with the text in **§12 → "Reply to App Review (subscriptions
  resubmission)"**.

---

## 0c. Resubmission — rejection 53b454b8 (2026-06-25)

**Resolved — fixed, shipped, and not raised in later reviews.** Kept for the record.
The first submission (v1.0, build 58, reviewed on iPad Air 11" M3) was rejected for **two**
issues. Both are now fixed in the repo; they required a **new EAS build + resubmit** (the
purpose strings are baked into the binary) and a **reply in Resolution Center**.

### Fix 1 — Guideline 5.1.1(ii): purpose strings

The camera / photo-library / microphone purpose strings were vague (photo-library was still the
Expo default `"Allow $(PRODUCT_NAME) to access your photos"` because `app.json` never set
`photosPermission`; microphone said "when you capture a video" but the mic is used for voice
memos). Fixed in `apps/mobile/app.json` → `expo-image-picker` plugin. Final strings (regenerated
into `ios/Sirius/Info.plist` at build time):

- **NSPhotoLibraryUsageDescription** — "Sirius needs access to your photo library so you can
  attach existing photos or videos to a capture — for example, selecting a screenshot to turn
  into an organized entry in your library."
- **NSCameraUsageDescription** — "Sirius uses the camera so you can take a photo or record a
  video and save it as a capture — for example, snapping a receipt or whiteboard to draft and
  organize in your private library."
- **NSMicrophoneUsageDescription** — "Sirius uses the microphone so you can record a voice memo
  to save as a capture — for example, dictating a quick idea that Sirius drafts into an organized
  entry."

### Fix 2 — Guideline 5.1.1(v): in-app account deletion

There was no self-service deletion (the support FAQ only said "email us"). Added a real in-app
deletion flow on **both iOS and web**, via better-auth's `deleteUser`:

- `packages/auth/src/index.ts` — `user.deleteUser.enabled: true` with a `beforeDelete` hook that
  calls `purgeUserFiles(userId)` (`packages/auth/src/delete-user-files.ts`) to remove the user's
  retained originals + archive zips; the User row deletion cascades every user-owned table
  (`onDelete: Cascade` in `schema.prisma`).
- **iOS:** Account tab → **Danger zone → Delete account** → destructive confirm → re-enter
  password → `deleteUser({ password })` → local auth/biometric state wiped → back to sign-in
  (`apps/mobile/src/app/(tabs)/settings.tsx`).
- **Web:** Settings → **Delete Account** section → type `DELETE` + password → `deleteUser` →
  redirect to `/sign-in` (`apps/web/app/(app)/settings/delete-account-button.tsx`).
- Deletion is **immediate and permanent** — no deactivation, no email/customer-service step.
- Support FAQ updated to describe the in-app flow (`apps/web/app/(public)/support/page.tsx`).

### Resubmit checklist

- [ ] `bun run deploy` (web) so the new `deleteUser` endpoint + updated FAQ are live on
  `lesswhelmed.com` **before** the binary is reviewed.
- [ ] New iOS build + submit (`cd apps/mobile && bunx eas-cli build --profile production
  --platform ios` → `bunx eas-cli submit --profile production --platform ios --latest`).
- [ ] **Re-seed the reviewer account** after testing deletion (`DATABASE_URL=<prod> bun run
  reviewer:seed --password '…'`) — the demo account/content may have been deleted while testing.
- [ ] **Record the deletion flow on a physical device** (sign in → Account → Delete account →
  password → signed out) and paste it into App Review Information → **Notes**. Apple explicitly
  requires this video.
- [ ] Reply in Resolution Center with the text in **§12 → "Reply to App Review (resubmission)"**.

---

## ⚠️ Needs your input / decisions

- [ ] **Deploy the new legal pages.** `apps/web/app/(public)/privacy/page.tsx` and
  `…/support/page.tsx` must be live at `https://lesswhelmed.com/privacy` and `/support`
  **before** you submit. Deploy with `bun run deploy`.
- [ ] **Create a reviewer account on prod** (the app gates on login). The fastest path is
  `DATABASE_URL=<prod-url> bun run reviewer:seed --password '…'` (seeds a verified
  `reviewer@lesswhelmed.com` + safe-for-work demo content — see section 1). Put the
  credentials in App Review notes (section 12). Do not use your personal account.
- [ ] **Confirm the contact email.** The privacy + support pages and the guide use
  `saleebmina@copt.dev`. Change it if you want a dedicated support inbox.
- [ ] **Pick the primary category** (recommended **Productivity**, secondary **Lifestyle** —
  see section 7). Confirm or change.
- [ ] **Confirm the age rating answers** (see "Age rating questionnaire" below). Answer the
  questionnaire honestly; with the recommended answers Sirius rates **4+**.
- [ ] **Current ASC state:** confirm whether an earlier build is already "In Review", or
  whether you want to submit the latest FINISHED build fresh
  (`bunx eas-cli build:list --platform ios`).

---

## Detected environment (pinned)


| Tool                  | Version (this repo)                  | Source                                       |
| --------------------- | ------------------------------------ | -------------------------------------------- |
| Expo SDK              | `56.0.11`                            | `apps/mobile/package.json`, root `overrides` |
| React Native          | `0.85.3`                             | `apps/mobile/package.json`                   |
| React                 | `19.2.3`                             | pinned in root `overrides`                   |
| eas-cli               | `>= 20.0.0`                          | `apps/mobile/eas.json` → `cli.version`       |
| Node (build)          | `22.12.0`                            | `eas.json` build profiles                    |
| Bun                   | `1.3.14`                             | root `packageManager`                        |
| iOS deployment target | Expo SDK 56 default (not overridden) | `app.json`                                   |


---

## 1. Prerequisites checklist

- [x] Apple Developer Program membership — Team **L7U86T3YRV** (Mina Saleeb, Individual)
- [x] Distribution cert + provisioning profiles on EAS (valid to **2027-06-01**), for both
  `dev.copt.sirius` and `dev.copt.sirius.share-extension`
- [x] Logged into EAS — `minasaleeb` / `saleebmina@copt.dev`
  (verify any time: `cd apps/mobile && bunx eas-cli whoami`)
- [x] App Store Connect access (same Apple ID on the team)
- [x] A Mac is **optional** — EAS builds in the cloud. You only need a Mac for the
  interactive `eas submit` Apple login (or use an ASC API key for non-interactive).

**Reviewer account (one command).** The app gates on login, so App Review needs working
credentials. Seed a verified reviewer + safe-for-work demo library directly on prod:

```sh
DATABASE_URL='<prod-database-url>' bun run reviewer:seed --password 'StrongPass123'
```

This upserts `reviewer@lesswhelmed.com` (verified, handle set so it skips onboarding) and a
populated Catalog/Queue/Explore. Pass `--teardown` later to remove the demo content. To
capture screenshots from your **own** account instead, sign in locally with that account
and run the screenshot script with `--skip-seed` (section 8).

---

## 2. App identity


| Field                                          | Value                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| App name                                       | **Sirius AI**                                                                          |
| Bundle ID                                      | `dev.copt.sirius` (+ `dev.copt.sirius.share-extension`)                                |
| Scheme                                         | `siriusapp`                                                                            |
| Marketing version (CFBundleShortVersionString) | `1.0.0` (`app.json` → `version`)                                                       |
| Build number (CFBundleVersion)                 | **EAS-managed** (`appVersionSource: remote`, `autoIncrement: true`) — latest is **24** |
| Runtime version                                | `fingerprint` policy (OTA updates only reach matching native builds)                   |


**Version policy:** never edit `buildNumber` by hand — EAS owns it. To ship a feature
release, bump `version` (e.g. `1.0.1`) in `app.json`; EAS auto-increments the build number.
For JS-only fixes to an already-shipped binary, use EAS Update (section 13).

---

## 3. App Store Connect app record

**Already created** (first `eas submit` ran 2026-06-14):

- [x] Bundle ID registered: `dev.copt.sirius`
- [x] App record exists — `ascAppId 6775729513` (backfilled into `eas.json` →
  `submit.production.ios.ascAppId`, so future submits are non-interactive)
- [ ] In App Store Connect → **App Information**, confirm: primary language, SKU, bundle ID,
  **content rights** (do you have rights to all content? yes — it's your catalog), and
  category (section 7).

---

## 4. Build for production with EAS

A FINISHED build already exists — you can skip straight to section 5. Only rebuild if you've
changed code since (confirm the latest with
`cd apps/mobile && bunx eas-cli build:list --platform ios --limit 5`).

> **Before any rebuild:** `eas.json` sets `requireCommit: true`, so the **git tree must be
> clean** — commit or stash any untracked/modified files first, or the build refuses to start.

```sh
# from repo root — the bundled skill script generates Prisma client, typechecks the
# mobile app, asserts a clean tree, kicks the prod build, and polls to completion:
.claude/skills/ios-app-store-deploy/scripts/build-ios-prod.sh

# …or directly:
cd apps/mobile
bunx eas-cli build --profile production --platform ios
```

- [ ] Build reaches **FINISHED** (watch the printed `expo.dev/...builds/...` URL)

**Common failure modes:**

- *Dirty tree* → "requireCommit" error. Commit/stash and retry.
- *"Configure expo-updates" phase error* (seen 2026-06) → usually a duplicate `llama.rn`
native module. See `HANDOFF-ios-build-failure.md`. Recent production builds succeeded, so
this is currently resolved — don't pre-emptively change the `llama.rn`/provider pinning.
- *Credential errors* → shouldn't happen (managed by EAS); if so, `bunx eas-cli credentials`.

---

## 5. Submit the build to App Store Connect

Because `ascAppId` + `appleTeamId` are in `eas.json`, this is nearly turnkey.

**Preferred — EAS submit (interactive Apple login):**

```sh
cd apps/mobile
bunx eas-cli submit --profile production --platform ios --latest
# or target a specific build instead of --latest:
# bunx eas-cli submit --profile production --platform ios --id df285dbd-eb69-4fa4-b877-b8e5099b855b
```

- [x] Sign in with the Apple ID on Team `L7U86T3YRV` (+ 2FA)
- [x] EAS uploads the `.ipa`; ASC then "processes" it (a few minutes to ~1 hr)

**Non-interactive alternative** (if you create an App Store Connect API key — `.p8` + Key ID

- Issuer ID):

```sh
cd apps/mobile
EXPO_APPLE_API_KEY_PATH=/path/AuthKey_XXXX.p8 \
EXPO_APPLE_API_KEY_ID=XXXXXXXXXX \
EXPO_APPLE_API_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
bunx eas-cli submit --profile production --platform ios --latest --non-interactive
```

**Manual alternative:** download the `.ipa` from the EAS build page and upload via
**Transporter** (Mac App Store). Slower; only if `eas submit` misbehaves.

---

## 6. TestFlight (optional but recommended)

- [ ] Once the build is processed, it appears under **TestFlight**.
- [ ] **Internal testing** (up to 100 users on your team) needs no beta review — fastest way
  to smoke-test the prod binary against `lesswhelmed.com`.
- [ ] **External testing** (public/large groups) requires a one-time **Beta App Review**.
- [ ] Verify on a real device that login works against prod and the main tabs load before
  submitting for App Review.

---

## 7. Store listing / metadata (drafted — edit to taste)

All copy below respects Apple's character limits. Paste into App Store Connect →
**[your app] → [version] → App Store** tab.

> **Positioning:** Sirius is the **"no-app"** — the place anything you share from any app
> lands and gets handled for you. From wherever you already are (the iOS Share Sheet) you
> send a link, photo, screenshot, note, repo, video, document, or voice memo; AI drafts a
> clean entry; and you curate and keep what you choose in your own **private** library. The
> hook is *share-from-anywhere*; the payoff is a *private personal catalog*. Posts are
> **private by default**, but the Friends feed now lets users share posts with friends —
> that's user-generated content others can see, so the age rating must declare UGC = Yes
> (see §0) and the copy should say "private by default", never "private, period". The copy
> and screenshots both reflect this. (The in-app tab is now called **Explore** — formerly
> "Tree"; keep listing copy aligned to "Explore".)

> **Tip:** each value below is in its own code block — hover it and click the copy icon to
> grab the exact text, then paste it straight into App Store Connect.

**App Name** (≤30):

```text
Sirius AI
```

**Subtitle** (≤30) — *27 chars; the share-from-anywhere hook*:

```text
Share anything from any app
```

**Promotional text** (≤170, editable without review) — *164 chars*:

```text
Found something worth keeping? Share it to Sirius from any app — a link, photo, note, or video — and AI drafts a clean, organized entry in your own private library.
```

**Keywords** (≤100, comma-separated, **no spaces**) — *98 chars; "AI" is dropped (it's in the
name "Sirius AI") and "share"/"anything"/"app" are dropped (in the subtitle) since Apple
combines name + subtitle words with the keyword field automatically*:

```text
bookmark,read,later,clipper,sharesheet,screenshot,notes,summary,organizer,catalog,links,save,memos
```

**Description** (≤4000):

```text
Sirius is the "no-app" — the place anything you share from any app lands and gets handled for you.

See something worth keeping? Don't switch apps, don't copy-paste, don't lose it in a sea of tabs. Just tap Share and send it to Sirius — a link, a photo or screenshot, a note, a video, a document, a code repo, even a voice memo — and Sirius turns it into a clean, organized entry, drafted for you by AI.

SHARE FROM ANYWHERE
Sirius lives in the iOS Share Sheet, so you can capture from your browser, social apps, Photos, Files, or anywhere else — without breaking your flow. There's no new habit to learn: if it's worth keeping, share it.

LET AI DO THE WRITE-UP
Every capture is drafted into a structured post — title, summary, tags, and details — that you review, edit, and keep. On iPhone, Sirius can even draft entirely on-device.

KEEP IT ALL, FIND IT LATER
• Catalog — your private library of everything you've kept.
• Queue — watch each capture move from pending to done.
• Explore — map and browse everything by theme and topic.

PRIVATE BY DEFAULT
Your posts are private to you. Sirius does not use third-party advertising or cross-app tracking.

Stop hoarding tabs and screenshots you'll never find again. Share it to Sirius, and let it get handled.
```

**What's New** (≤4000) — for v1.0.0:

```text
First release of Sirius — the no-app. Share anything from any app — links, photos, screenshots, notes, videos, even voice memos — and let AI draft a clean, organized entry in your own private library. Capture, draft, and keep what matters.
```

**Support URL:**

```text
https://lesswhelmed.com/support
```

**Marketing URL** (optional):

```text
https://lesswhelmed.com
```

**Privacy Policy URL:**

```text
https://lesswhelmed.com/privacy
```

**Copyright:**

```text
2026 Mina Saleeb
```

- **Category:** Primary **Productivity**, Secondary **Lifestyle**
*(alternatives: Shopping, or Reference — Productivity fits the catalog/inventory workflow best)*

- [ ] All metadata fields filled, no placeholder text

---

## 8. Screenshots & previews

**Required:** one set of **6.9-inch iPhone** screenshots. Uploading 6.9" covers all modern
iPhones — you do **not** need 6.5", and you do **not** need iPad (the app sets no
`supportsTablet`).

- **Exact pixel size:** **1320 × 2868** portrait (also accepted for the 6.9" slot: 1290×2796).
- **Count:** 3–10 per localization (Apple requires at least 1; aim for 3–5 strong ones).
- **Captured for you** into `app-store-assets/screenshots/iphone-6.9/` from the
"Sirius 6.9 ProMax" simulator (an iPhone 17 Pro Max, native 1320×2868). Six shots:


| Order | File                 | Screen                                                        |
| ----- | -------------------- | ------------------------------------------------------------- |
| 1     | `01-capture.png`     | Capture — the material picker (Link/Repo/Note/Photos/…)       |
| 2     | `02-catalog.png`     | Catalog — your library (filtered to a clean category)         |
| 3     | `03-queue.png`       | Queue — captures moving pending → processing → done           |
| 4     | `04-tree.png`        | Explore → Categories — the taxonomy outline + Rediscover rail |
| 5     | `05-post-detail.png` | A drafted post — hero image, title, tags, body                |
| 6     | `06-explore.png`     | Explore → Map — the 3D constellation of topics & posts        |


> The **Explore** tab was formerly "Tree"; `04-tree.png` keeps its filename (downstream
> references depend on it) but shows the Explore → Categories view.

Do / don't:

- ✅ Real in-app screens, clean status bar, portrait.
- ✅ You may add a marketing frame/caption, but raw screenshots are accepted as-is.
- ❌ No device bezels that misrepresent the UI, no placeholder/lorem content, no other
platforms' chrome.

- [ ] Upload the PNGs from `app-store-assets/screenshots/iphone-6.9/` to the 6.9" slot

**Regenerate (reproducible).** The single source of truth is
`scripts/marketing/capture-app-store-screenshots.sh` (root alias
`bun run app-store:screenshots`). With the dev stack running (`bun run dev`), it seeds a
safe-for-work demo library, launches the dev client cleanly (no `<- AgentDeviceRunner`
return chip in the status bar), navigates the six screens with `agent-device`, captures each
at 1320 × 2868, asserts the size, and mirrors them into `apps/web/public/product/screens/`.

```sh
# terminal 1: bun run dev          # web + worker + mobile dev client on the 6.9" sim
# terminal 2:
REVIEWER_PASSWORD='…' bun run app-store:screenshots            # seed + capture
REVIEWER_PASSWORD='…' bun run app-store:screenshots --skip-seed # reuse existing session/data
```

To capture from your own account instead of the seeded reviewer, sign in with it and pass
`REVIEWER_EMAIL` / `REVIEWER_PASSWORD --skip-seed`. Manual one-off:

```sh
# boot the 6.9" sim, run the app, then:
xcrun simctl io booted screenshot app-store-assets/screenshots/iphone-6.9/NN-name.png
# verify size:
sips -g pixelWidth -g pixelHeight app-store-assets/screenshots/iphone-6.9/NN-name.png
```

---

## 9. App Privacy ("nutrition label")

Fill App Store Connect → **App Privacy** to match what the app actually collects (consistent
with `apps/web/app/(public)/privacy/page.tsx`). Sirius does **not** track and shows no ATT
prompt → answer **"No"** to tracking.


| Data type                                     | Collected? | Linked to user? | Purpose           | Tracking? |
| --------------------------------------------- | ---------- | --------------- | ----------------- | --------- |
| Contact Info — Email address                  | Yes        | Yes             | App Functionality | No        |
| Contact Info — Name                           | Yes        | Yes             | App Functionality | No        |
| User Content — Photos/Videos                  | Yes        | Yes             | App Functionality | No        |
| User Content — Other (URLs, notes, posts)     | Yes        | Yes             | App Functionality | No        |
| Identifiers — User ID                         | Yes        | Yes             | App Functionality | No        |
| Usage Data — Product Interaction (post views) | Yes        | Yes             | Analytics         | No        |


- Diagnostics/Crash data: **not collected** (no crash SDK configured).
- Third-party advertising / data "sold": **No**.

- [ ] App Privacy completed and matches the privacy policy

---

## Age rating questionnaire (App Store Connect)

In App Store Connect → your app → **App Information → Age Rating → Edit**, Apple asks a
content questionnaire (each row: **None / Infrequent or Mild / Frequent or Intense**) plus a
few capability questions. Answer honestly — Sirius is a personal capture/notes tool with no
built-in mature content, so every content row is **None**. Recommended answers:


| Question                                              | Answer   |
| ----------------------------------------------------- | -------- |
| Cartoon or Fantasy Violence                           | **None** |
| Realistic Violence                                    | **None** |
| Prolonged Graphic or Sadistic Realistic Violence      | **None** |
| Profanity or Crude Humor                              | **None** |
| Mature/Suggestive Themes                              | **None** |
| Horror/Fear Themes                                    | **None** |
| Medical/Treatment Information                         | **None** |
| Alcohol, Tobacco, or Drug Use or References           | **None** |
| Sexual Content or Nudity                              | **None** |
| Graphic Sexual Content and Nudity                     | **None** |
| Simulated Gambling                                    | **None** |
| Contests                                              | **None** |
| Gambling (real money)                                 | **No**   |
| Unrestricted Web Access (a built-in open web browser) | **No**   |
| Made for Kids                                         | **No**   |


Capability / regulatory questions Apple now also asks:

- **Does the app contain user-generated content others can see?** → **Yes.** *(Changed
2026-07-03 — this answer was "No" pre-Friends-feed and caused the Guideline 2.3.6
rejection in submission 2c02b4c2; see §0.)* The Friends hub / feed shows friends' shared
(FRIENDS/GROUP/PUBLIC) posts cross-user. Set **User-Generated Content: Yes** in App
Information → Age Rating. Any follow-on moderation questions: the app requires terms
agreement at registration, has in-app report + block mechanisms, and reports are acted
on within 24 hours (§0 Parts A–D — must be shipped before answering).
- **Messaging / communication between users?** → **No.** (No DMs/comments between users —
  sharing posts to a feed is covered by the UGC answer above.)
- **Unrestricted web access?** → **No.** Sirius fetches specific URLs you submit for
drafting; it is not a general-purpose web browser.

**Resulting rating:** with UGC = Yes the computed rating may come back **higher than 4+**
(e.g. 13+ under Apple's updated rating system). Accept whatever the questionnaire
computes — under-declaring is what got build 72 rejected.

- [ ] Age rating questionnaire completed with **User-Generated Content: Yes**

---

## 10. Export compliance / encryption

- [x] `ITSAppUsesNonExemptEncryption: false` is set in `app.json` (`ios.infoPlist`), so the
  binary declares it uses only exempt encryption (standard HTTPS).
- [ ] In the submission flow, the encryption question is therefore answered automatically as
  **"No"** (uses only exempt/standard encryption). Nothing else to file.

---

## 11. Pre-submit verification checklist

- [ ] `https://lesswhelmed.com/privacy` returns 200 (deployed)
- [ ] `https://lesswhelmed.com/support` returns 200 (deployed)
- [ ] `https://lesswhelmed.com/terms` returns 200 (deployed — §0 Part A)
- [ ] Report + block work end-to-end against prod (report email arrives; blocked user's
  posts vanish from the feed without refresh-lag) — §0 Parts B/C
- [ ] The latest FINISHED build (or your chosen build) is **processed** in App Store Connect
- [ ] Screenshots uploaded to the 6.9" slot (1320×2868)
- [ ] Name, subtitle, description, keywords, URLs, copyright all set — no placeholders
- [ ] Category set; age rating questionnaire completed
- [ ] App Privacy completed
- [ ] Export compliance answered (No)
- [ ] Reviewer demo account created on prod, email verified, **tested**, and entered in
  App Review notes
- [ ] App icon shows (1024² no alpha — already in the binary)

---

## 12. Submit for review

In App Store Connect → your version:

- [ ] **App Review Information** → add the reviewer demo account. Copy the notes block below
  (fill in the username/password fields in ASC separately):

```text
Sirius requires an account. Sign in with the demo credentials provided in the Username/Password fields. The app talks to https://lesswhelmed.com. Main flow: Capture tab → paste a URL or add a photo/note → it drafts a catalog entry → review in Catalog. Posts are private by default; the Friends tab shows posts that mutual friends have chosen to share (the demo account has several friends with shared posts). User-generated content controls: users must agree to our Terms of Use (zero tolerance for objectionable content) before registering or signing in; every post in the Friends feed has a "…" menu with Report post and Block user (blocking removes their content instantly and notifies us); reports are acted on within 24 hours. Account deletion: Account tab → Danger zone → Delete account → confirm with the account password. Screen recordings of the terms/report/block flows and the deletion flow are attached.
```

**Reply to App Review (UGC resubmission — rejection 2c02b4c2 — paste into Resolution
Center once §0 Parts A–E are shipped):**

```text
Guideline 1.2 — User-generated content precautions. Thank you. This build (together with our updated backend) implements all of the required precautions:

- Terms agreement (EULA): users must agree to our Terms of Use (https://lesswhelmed.com/terms) before registering — sign-up requires an explicit agreement checkbox — and existing users must accept the terms one time before continuing after sign-in. The terms state that there is no tolerance for objectionable content or abusive users, and that violating content is removed and offending users ejected.
- Flagging objectionable content: every post visible in the Friends feed (and on the post detail screen) has a Report action. Reports notify us immediately by email and are recorded for review.
- Blocking abusive users: every post from another user has a Block action. Blocking removes that user's content from the viewer's feed instantly, ends the friend relationship, and notifies us (the developer) immediately, including the content that prompted the block.
- 24-hour moderation: we review every report within 24 hours, remove objectionable content, and eject offending users (account ban). In addition, Sirius pre-moderates: every submission is scanned by an automated content-safety system before it can become a post; flagged material is never published and we are alerted immediately.

A screen recording captured on a physical device demonstrating (1) the terms agreement before registration/login, (2) flagging content, and (3) blocking a user with their content removed instantly is included in the App Review Information Notes.

Guideline 2.3.6 — Age rating. We updated the Age Rating selections in App Store Connect to answer "Yes" for User-Generated Content, and accepted the resulting rating.
```

**Reply to App Review (subscriptions resubmission — paste into Resolution Center):**

```text
Guideline 2.1(b) — In-App Purchase submitted. Thank you. The auto-renewable subscription "Sirius AI Pro" now has complete metadata and a review screenshot, is in the "Ready to Submit" state, and has been attached to this version so it is submitted together with this new binary for review.

Guideline 3.1.2(c) — Subscription information. The required information is now present in both the app and the metadata:
- In the purchase flow (paywall): the subscription title, length, and price are displayed, along with functional links to our Privacy Policy (https://lesswhelmed.com/privacy) and the standard Apple Terms of Use / EULA (https://www.apple.com/legal/internet-services/itunes/dev/stdeula/).
- In the App Store metadata: the Privacy Policy field links to https://lesswhelmed.com/privacy, and the App Description includes a functional link to the standard Apple Terms of Use (EULA).
A screen recording of the purchase flow showing the title, length, price, and both functional links is included in the App Review Information Notes.
```

**Reply to App Review (5.1.1 resubmission — paste into Resolution Center):**

```text
Guideline 5.1.1(ii) — Purpose strings. Thank you. We updated the camera, photo library, and microphone purpose strings to clearly describe their use with a specific example, included in this new build:
- Photo Library: "Sirius needs access to your photo library so you can attach existing photos or videos to a capture — for example, selecting a screenshot to turn into an organized entry in your library."
- Camera: "Sirius uses the camera so you can take a photo or record a video and save it as a capture — for example, snapping a receipt or whiteboard to draft and organize in your private library."
- Microphone: "Sirius uses the microphone so you can record a voice memo to save as a capture — for example, dictating a quick idea that Sirius drafts into an organized entry."

Guideline 5.1.1(v) — Account deletion. We added in-app account deletion. In the Account (Settings) tab, users tap Delete account, confirm by re-entering their password, and their account plus all associated content (posts, captures, uploaded files, and data) is permanently and immediately deleted — no email or customer-service step is required. A screen recording of the full flow on a physical device is included in the App Review Information Notes.
```

- [ ] Choose release option: **Manual release** (recommended for a first launch so you
  control go-live), Automatic, or Phased.
- [ ] Click **Add for Review → Submit**.

**What reviewers commonly reject (preempt these):**

- Login wall with no working demo account → covered by the reviewer account above.
- Broken privacy/support URLs → deploy the pages first (section 11).
- Privacy label not matching actual data use → section 9 mirrors the policy.
- Crash on launch → smoke-test via TestFlight (section 6) first.
- Guideline 2.1 incomplete metadata / placeholder content → checklist in section 11.

---

## 13. Post-submission

- **Review timeline:** typically 24–48 hours; first submissions can take longer.
- **If rejected:** read the Resolution Center message, fix the specific issue, reply or
resubmit. Most rejections are metadata/demo-account/privacy issues, not the binary.
- **Releasing:** if you chose Manual release, click **Release** once "Pending Developer
Release."
- **Shipping updates:**
  - *JS-only change* (no native deps changed) → **EAS Update** (OTA), no re-review:
    ```sh
    cd apps/mobile && bunx eas-cli update --branch production
    ```
    (Only reaches builds with a matching native fingerprint.)
  - *Native change or App Store metadata change* → bump `version`, new
  `eas build --profile production --platform ios`, `eas submit`, new review.

---

## Appendix — files added/changed in this repo for submission

- `apps/web/app/(public)/privacy/page.tsx` — Privacy Policy page (deploy → `/privacy`)
- `apps/web/app/(public)/support/page.tsx` — Support page (deploy → `/support`)
- `app-store-assets/screenshots/iphone-6.9/` — 6.9" screenshots (1320×2868) + manifest
- `scripts/marketing/capture-app-store-screenshots.sh` — reproducible capture (alias
`bun run app-store:screenshots`)
- `scripts/create-reviewer-account.ts` — reviewer + demo content (alias `bun run reviewer:seed`)
- `APP_STORE_SUBMISSION.md` — this guide

Planned for the UGC resubmission (§0 — not yet written as of 2026-07-03):

- `apps/web/app/(public)/terms/page.tsx` — Terms of Use w/ zero-tolerance clause (→ `/terms`)
- sign-up agreement checkboxes — `apps/mobile/src/app/(auth)/sign-up.tsx`,
  `apps/web/app/(auth)/sign-up/page.tsx` (+ one-time acceptance gate for existing accounts)
- `ContentReport` + `UserBlock` models + `packages/db/src/moderation.ts` helpers + migration
- `POST /api/app/posts/[slug]/report`, `POST|DELETE /api/app/users/[id]/block`,
  `GET /api/app/blocks`, `POST /api/app/account/accept-terms`
- report/block UI — mobile `friends-feed-list.tsx` / `post/[slug]` / `u/[handle]/catalog.tsx`;
  web `catalog-card.tsx` kebab + post-detail control; blocked-users management in settings
- `scripts/moderation/resolve-report.ts` — list/takedown/ban/resolve CLI

