# Runbook — push the UGC-safety set to prod + resubmit to App Review

Mission: answer App Store rejection **2c02b4c2** (Guideline 1.2 UGC + 2.3.6 age rating).
Code is on `main` (commits `ad5dacb`, `9d71616`, `ec541ce`, `ac161b0`, `ea3a0d6`).
Plan + prepared reply text live in `APP_STORE_SUBMISSION.md` §0 (and §12 for the reply).

Steps 1–4 are terminal work. Steps 5–9 are Apple-side (App Store Connect + a physical
device) and need a human.

---

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

```sh
DATABASE_URL="<prod-postgres-url>" WEB_URL="https://lesswhelmed.com" \
  bun run reviewer:seed --password '<the-reviewer-password>'
```

The seed nulls the reviewer's `termsAcceptedAt` **by default** as its final step
(`--keep-terms` to skip), so App Review's first sign-in shows the acceptance screen.
The summary must print `Terms gate: armed — first sign-in shows the acceptance screen`.

Use the password already in App Store Connect → App Review Information — or update ASC
if a new one is generated (the script prints it once; it is not stored anywhere).

## 4. Sanity-check the live flow as the reviewer

Sign in at `https://lesswhelmed.com/sign-in` with the reviewer credentials:

1. Terms acceptance screen appears → Agree → land in the app (once only; refresh to
   confirm it does not reappear).
2. Friends feed → open a friend's post → **Report** (reason picker) and **Block** both
   work; blocked author's rows disappear from the feed.
3. Settings → **Blocked users** → Unblock works.

This is exactly what Apple will do first.

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

On the **physical device**, one continuous screen recording (~2 min max):
sign in as reviewer → terms acceptance screen → Agree → open a friend's post →
Report (pick a reason) → Block user → post gone from feed → Settings → Blocked users.

## 9. Reply in Resolution Center

Use the prepared text in `APP_STORE_SUBMISSION.md` **§12 → "Reply to App Review (UGC
resubmission)"**, attach the recording, confirm the reviewer credentials in App Review
Information are current, and submit the version for review.

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
