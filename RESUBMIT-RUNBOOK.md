# Resubmit Runbook — rejection 2c02b4c2 (UGC safety + age rating)

Step-by-step operator checklist to go from the current state of `main` to a new
submission in App Review. **This file duplicates nothing** — every step points at the
authoritative resource. The full context, rationale, and templates live in
**`APP_STORE_SUBMISSION.md` §0** (read it once before starting).

**Current state (2026-07-03):** all code is DONE, verified, and pushed on `main` —
commits `ad5dacb` (db/auth), `9d71616` (web), `ec541ce` (mobile), `ac161b0` (CLI/seed/docs),
`ea3a0d6` (review fixes). Everything below is ops: deploy → seed → App Store Connect →
build → record → reply.

---

## 1. Sync your checkout

```sh
git pull --ff-only
bun install
bun run db:generate          # required after the new migration (see CLAUDE.md → Database)
bun run db:migrate:deploy    # local dev DB only; prod happens in step 3
```

## 2. (Recommended) Local smoke of the three Apple-facing flows

Start the stack with `bun run dev` (interactive `! bun run dev` if :443 prompts — see
memory/CLAUDE.md portless notes), sign in on the iOS simulator, and walk the three flows
listed in **`APP_STORE_SUBMISSION.md` §0 Part F** (terms gate → report → block). Your
existing dev account will see the one-time Terms screen once — that's the feature.

## 3. Deploy web + worker to prod

```sh
bun run deploy               # pushes main, runs deploy.sh on the server (incl. prisma migrate deploy)
```

Then verify per **§11 pre-submit checklist**: `https://lesswhelmed.com/terms` (new),
`/privacy`, `/support` all return 200.

## 4. Re-seed the reviewer account on prod

Command + details: **`APP_STORE_SUBMISSION.md` §1 → "Reviewer account (one command)"**
and the header comment of `scripts/create-reviewer-account.ts`.

```sh
DATABASE_URL='<prod-url>' WEB_URL='https://lesswhelmed.com' bun run reviewer:seed --password '<StrongPass>'
```

Note: the seed now **arms the Terms gate by default** (nulls the reviewer's
`termsAcceptedAt`; opt out with `--keep-terms`) so App Review sees the acceptance screen
on sign-in. The summary line at the end confirms "Terms gate: armed".

## 5. App Store Connect changes (no code)

1. **Age Rating → User-Generated Content = Yes** — exact guidance:
   **`APP_STORE_SUBMISSION.md` §0 Part E** + the corrected **"Age rating questionnaire"**
   section (accept whatever rating it computes).
2. *(Optional, recommended — "Decisions needed" item 1 in §0)*: swap the Terms links from
   Apple's std EULA to `https://lesswhelmed.com/terms` in the **App Description** (§7) and
   the **RevenueCat paywall footer**. The in-app subscription-card link swap is a 2-line
   code change in `apps/mobile/src/components/subscription-section.tsx` (`TERMS_URL`) —
   ask Claude or edit before the build in step 6 if you want it in this binary.
3. Update **App Review Information → Notes** with the new notes block:
   **`APP_STORE_SUBMISSION.md` §12** (first ```text block — it now mentions the Friends
   feed, terms gate, report/block, 24h moderation).

## 6. New iOS build + submit

EAS needs a clean committed tree (`requireCommit: true`). Commands and failure modes:
**`APP_STORE_SUBMISSION.md` §4–§5**, or use the skill script
`.claude/skills/ios-app-store-deploy/scripts/build-ios-prod.sh`.

```sh
cd apps/mobile
bunx eas-cli build --profile production --platform ios
bunx eas-cli submit --profile production --platform ios --latest
```

Attach the subscription ("Sirius AI Pro") to the version again if ASC asks — see §0b.

## 7. Screen recording (physical device)

Record ONE video showing the three items Apple listed — the exact shot list is
**`APP_STORE_SUBMISSION.md` §0 Part F**. Upload/reference it in App Review
Information → Notes.

## 8. Reply in Resolution Center

Paste the prepared reply: **`APP_STORE_SUBMISSION.md` §12 → "Reply to App Review (UGC
resubmission — rejection 2c02b4c2)"**. Submit for review.

## 9. While waiting / if a report ever arrives

Moderation duty (the 24h SLA you committed to in the reply): usage and flow are in the
`--help` of `bun run scripts/moderation/resolve-report.ts` (list → takedown/delete →
ban → resolve). Report/block alerts email `SAFETY_ALERT_EMAIL` (defaults to
saleebmina@copt.dev).

---

Deeper references: implementation deviations ledger (session scratchpad `DEVIATIONS.md`),
moderation architecture (`docs/safety-guardrails.md` for the pre-existing proactive gate),
deploy internals (`DEPLOY.md`).
