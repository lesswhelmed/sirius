# Runbook — push the UGC-safety set to prod + resubmit to App Review

Mission: answer App Store rejection **2c02b4c2** (Guideline 1.2 UGC + 2.3.6 age rating).
Code is on `main` (commits `ad5dacb`, `9d71616`, `ec541ce`, `ac161b0`, `ea3a0d6`).
Plan + prepared reply text live in `APP_STORE_SUBMISSION.md` §0 (and §12 for the reply).
Builds **71/72/73 are not sufficient** for this rejection. Record and submit only a new
build that includes the full UGC moderation set below.

Steps 1–4 are terminal work. Steps 5–9 are Apple-side (App Store Connect + a physical
device) and need a human.

---

## 0. Coverage inventory — what Apple needs proved

Apple's 1.2 ask has four obligations. Only the first three are visible in a device
recording; the fourth is an operations commitment backed by email alerts + CLI tooling.

- **Terms/EULA before registration or login:** `/terms`, sign-up checkbox, sign-in notice,
  and one-time `termsAcceptedAt` gate for existing accounts.
- **Flag objectionable content:** report action on peer posts, `ContentReport`, immediate
  developer email to `SAFETY_ALERT_EMAIL`, idempotent re-reporting.
- **Block abusive users:** directional `UserBlock`, developer email with post context,
  instant feed/search/catalog/embedding exclusion, blocked-users management + unblock.
- **Act within 24 hours:** moderation CLI can list open reports, takedown/delete content,
  ban/eject the offending user, and resolve the report.

Extra protection to mention in the reply, but **not** to demo with harmful content in the
video: the worker's harmful-content safety gate scans user-produced uploads/notes before a
post exists; flagged material is quarantined, never published, and emails the developer.

## 1. Deploy web + worker (runs the migration)

```sh
bun run deploy
```

From repo root. Pushes `main`, SSHes to the server, runs `deploy.sh`:
`git pull --ff-only` → `bun install --frozen-lockfile` → `db:generate` →
**`db:migrate:deploy`** (applies `20260703103525_ugc_moderation` — ContentReport,
UserBlock, `User.termsAcceptedAt`) → build → `pm2 startOrReload` → verifies the public
URL returns 200.

Needs local `.env.production` (generate with `bun run env:production` if missing).

## 2. Verify prod actually has the feature (2 minutes)

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://lesswhelmed.com/terms
# expect 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://lesswhelmed.com/api/app/account/accept-terms
# expect 401 (route exists, session required)
```

A 404 on either means the deploy didn't pick up the new routes — stop and investigate
before going further.

## 3. Re-seed the reviewer account (arms the terms gate)

**Run this ON the server** — prod Postgres refuses remote connections (P1010 if run
locally). The server repo's `.env` already carries the prod `DATABASE_URL`:

```sh
set -a; source .env.production; set +a
ssh -i "$DEPLOY_SSH_KEY" "deploy@$DEPLOY_HOST" \
  "cd $DEPLOY_APP_DIR && WEB_URL=https://lesswhelmed.com bun run scripts/create-reviewer-account.ts"
```

Omit `--password` on a re-run to **keep the existing ASC password** (the friends step
self-skips with a notice — fine, the demo friends already exist on prod). The seed nulls
the reviewer's `termsAcceptedAt` **by default** as its final step (`--keep-terms` to
skip), so App Review's first sign-in shows the acceptance screen. The summary must print
`Terms gate: armed — first sign-in shows the acceptance screen`.

> Executed 2026-07-03: deploy + verification + seed all green; gate armed; password
> unchanged; 16 posts / 5 focus areas re-seeded through the worker pipeline.

## 4. Sanity-check the live flow as the reviewer

Sign in at `https://lesswhelmed.com/sign-in` with the reviewer credentials:

1. Terms acceptance screen appears → Agree → land in the app (once only; refresh to
   confirm it does not reappear).
2. Friends feed → open a friend's post → **Report** (reason picker) and **Block** both
   work; blocked author's rows disappear from the feed.
3. Settings → **Blocked users** → Unblock works.

This is exactly what Apple will do first.

> **⚠️ Re-arm the gate afterwards.** Accepting the terms in this check (or in the step-8
> recording) stamps `termsAcceptedAt` — the gate is one-time, so Apple would NOT see it.
> After your last manual pass / recording, and **before submitting for review**, re-run
> step 3's seed command (it re-nulls the stamp; everything else is idempotent). Also
> undo any test block (unblock via Settings) so the reviewer's feed is fully populated.

Do this smoke on web first, then on the **new TestFlight build** after step 7. Builds
71/72/73 are stale for this rejection; the evidence video must come from the binary that
contains the UGC safety work.

## 5. App Store Connect config (Part E — Guideline 2.3.6)

- ASC → app → **App Information → Age Rating → Edit** → set
  **User-Generated Content: Yes** → save (the computed rating may change; accept it).
- **Gate for resubmission:** §0b's IAP items must also be done or Apple re-rejects on
  the subscription issue even with UGC fixed — subscription metadata complete, moved to
  "Ready to Submit", **attached to this app version**, RevenueCat paywall footer links
  configured. Full list: `APP_STORE_SUBMISSION.md` §0b.

## 6. Build the iOS production binary

Tree must be clean and committed (EAS `requireCommit: true` builds the committed tree
only — coworkers' in-flight files must be committed or their absence acceptable):

```sh
bun run mobile:build:ios      # eas build --profile production --platform ios
```

The `verify:native-ai` gate runs automatically pre-build. Build numbers are
EAS-remote-managed. Full build details: the `ios-app-store-deploy` skill /
`apps/mobile/eas.json`.

## 7. Submit to App Store Connect

```sh
bun run mobile:submit:ios     # eas submit --profile production --platform ios
```

In ASC, select the new build on the version page. Install via TestFlight on a real
phone and repeat step 4's flow natively once (sign-up agree-checkbox, terms gate,
report, block, Settings → Blocked users).

## 8. Record the evidence (Part F)

Apple asked for a **screen recording captured on a physical device**. Do not use the
simulator. Record the new TestFlight/App Store Connect build, not an old local/dev build.

Mental model: the video proves the **three reviewer-visible controls**. The reply text
and notes explain the non-visible controls: report/block alert emails, the 24-hour
moderation CLI, and the harmful-content pre-publish safety gate.

### 8a. Pre-recording state

Before pressing Record:

1. Install the new TestFlight build on a real iPhone/iPad.
2. Sign out of Sirius if needed so the video starts from a clean auth state.
3. Re-run step 3's reviewer seed so:
   - the reviewer account exists, is email-verified, and has friends with shared posts;
   - `termsAcceptedAt` is null, so the one-time terms gate will appear;
   - any previous test data is reset enough for the feed to look populated.
4. If the reviewer account currently has blocked users from testing, unblock them first
   (Account/Settings → Blocked users), then re-run the seed again.
5. Confirm App Store Connect Age Rating already says **User-Generated Content: Yes**.

If you do a dry run on the same reviewer account, it consumes the one-time terms gate.
Re-run step 3 again before the real recording.

### 8b. Recording script

Keep it one continuous video, roughly 2–4 minutes. Move slowly enough for Apple to read
the labels and confirmation alerts.

1. **Show terms before registration.**
   - Launch Sirius while signed out.
   - Open the sign-up screen.
   - Show that account creation has the required "I agree to the Terms of Use and Privacy
     Policy" checkbox.
   - Tap **Terms of Use** and briefly show the `/terms` page, especially the zero-tolerance
     language and 24-hour moderation promise.
   - Go back without creating a new account.

2. **Show terms before existing-user access.**
   - Sign in with the reviewer demo account.
   - Show the full-screen **Terms of Use** gate before the app/Friends feed is usable.
   - Tap **I agree** and wait until the app opens.

3. **Show the UGC surface.**
   - Open the **Friends** tab/feed.
   - Pause long enough to show that this feed contains posts shared by other users.
   - Open a friend's post, or use the feed row's **…** menu if visible.

4. **Show flag/report.**
   - Tap **Report post**.
   - Pick a concrete reason, preferably **Objectionable content** or **Abusive or
     harassing**.
   - Wait for the confirmation: **Reported — We review reports within 24 hours.**

5. **Show block and instant feed removal.**
   - From the same friend's post/feed row, open the **…** menu again.
   - Tap **Block @handle**.
   - Confirm the destructive **Block** prompt.
   - Wait for the **Blocked** confirmation.
   - Return to / remain on the Friends feed and show that the blocked author's posts are
     gone without relaunching the app.

6. **Show block management.**
   - Go to **Account/Settings → Blocked users**.
   - Show the blocked user in the list and the available **Unblock** control.
   - Do **not** unblock during the recording unless you immediately re-block afterward;
     Apple asked to see the blocked state.

### 8c. What not to put in the video

- Do not submit harmful sample content in the app just to prove the safety classifier.
  The reviewer-visible requirement is report/block/terms; harmful-content detection is
  documented in the reply as proactive moderation.
- Do not show server logs, terminal commands, private admin email, or database output in
  the App Review video. Keep those as internal proof.
- Do not leave the reviewer account in a consumed state after filming.

### 8d. Internal proof before submission

These are not part of the screen recording, but they support the claims in the reply:

```sh
bun --cwd apps/worker run safety:try
bun run scripts/moderation/resolve-report.ts --list
```

Expected: the safety harness flags the synthetic harmful case without publishing a post,
and the moderation CLI lists the report created during the smoke/recording so we can act
inside the 24-hour SLA.

### 8e. Reset after recording

After the video is saved:

1. Export/upload the screen recording for App Store Connect notes.
2. Unblock the demo friend if the reviewer account should start with a full feed.
3. Re-run step 3 one final time so Apple sees the terms gate on their own first sign-in.
4. Confirm the seed summary prints `Terms gate: armed — first sign-in shows the acceptance screen`.

## 9. Reply in Resolution Center

Use the prepared text in `APP_STORE_SUBMISSION.md` **§12 → "Reply to App Review (UGC
resubmission)"**, attach the recording, confirm the reviewer credentials in App Review
Information are current, **re-run the step-3 seed one final time (re-arms the terms gate
your recording just consumed)**, and submit the version for review.

---

## Reference — what shipped (for whoever runs this later)

- **Terms gate:** `User.termsAcceptedAt` (better-auth additionalField, stamped fail-soft
  at sign-up). Null → one-time acceptance gate: web `(app)/layout.tsx`, mobile
  `(tabs)/_layout.tsx`.
- **Report:** `POST /api/app/posts/[slug]/report` (OBJECTIONABLE/ABUSE/SPAM/OTHER) →
  alert email to `SAFETY_ALERT_EMAIL`. Re-reporting a RESOLVED report reopens it.
- **Block:** `POST/DELETE /api/app/users/<id>/block` (segment resolves id-first, handle
  fallback), bidirectional exclusion threaded through feed/search/catalog/embeddings/
  `canReadPost`; severs friendship + share-group membership.
- **24h SLA tooling:** `bun run scripts/moderation/resolve-report.ts`
  `--list / --takedown <slug> / --delete <slug> --yes / --ban <user> --reason "…"
  [--private-all] / --unban <user> / --resolve <reportId> --resolution uphold|overturn`.
  Run within 24h of each alert email. `--delete`'s retained-originals disk purge is
  print-only — follow its `MANUAL CLEANUP REQUIRED` paths.
