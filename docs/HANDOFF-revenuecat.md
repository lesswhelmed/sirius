# RevenueCat + freemium AI cap — real setup, env, and operations

How the freemium feature works, **exactly which env var goes where**, and the
RevenueCat/App Store Connect steps that live outside the repo.

## What the code does

- **Free ingest, always.** Submitting URLs/images/notes is never gated.
- **Server AI drafting is capped** at `AI_WEEKLY_LIMIT` (default 10) generations
  per calendar week (Mon 00:00 UTC) for free users. Enforced in the worker
  (`apps/worker/src/pipeline/pipeline.ts`) around the `runGemini` call — the one
  place a paid generation happens. On-device drafts (`tryClientDraft`) and bearer
  (token) ingests are **not** metered.
- **Over the limit → editable DRAFT stub** (`apps/worker/src/pipeline/manual-stub.ts`),
  never a failure. The user writes it themselves in the editor (web
  `/posts/[slug]/edit`, mobile `post/[slug]/edit`).
- **"Sirius AI Pro" = unlimited.** Entitlement state lives in Postgres
  (`UserEntitlement`), written by the RevenueCat webhook (`applyRevenueCatEvent`),
  read by the worker (`checkProStatus`).
- **Identity:** mobile calls `Purchases.logIn(session.user.id)` (`PurchasesRunner`
  in `apps/mobile/src/app/_layout.tsx`), so RevenueCat's `app_user_id` == our
  `User.id` and the webhook can resolve the user. Don't break this contract.

---

## Env var matrix — what needs what

### Server — repo-root `.env` (loaded by web + worker; declared in `turbo.json` globalEnv)

| Var | Required? | Value | Read by |
| --- | --- | --- | --- |
| `REVENUECAT_WEBHOOK_SECRET` | **Yes** (for webhook) | A long random string you generate (`openssl rand -hex 32`). Paste the SAME value into RevenueCat's webhook **Authorization header** field. | `apps/web/lib/revenuecat/auth.ts` (the webhook rejects events without it) |
| `REVENUECAT_ENTITLEMENT_ID` | No (default `Sirius AI Pro`) | Must EXACTLY equal the entitlement identifier in the RevenueCat dashboard. | `packages/db/src/entitlement.ts` → `aiEntitlementId()` (webhook scoping + entitlement writes) |
| `AI_WEEKLY_LIMIT` | No (default `10`) | Integer — free server generations per week. | `packages/db/src/entitlement.ts` → `aiWeeklyLimit()` (worker enforcement + `getAiUsage`) |

Production also needs these mirrored into the server's `.env` (see `DEPLOY.md` /
`bun run env:production`). All three are already in `turbo.json` `globalEnv`.

### Mobile — `apps/mobile/.env` (local dev) and `apps/mobile/eas.json` (builds)

| Var | Where | Value | Read by |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | `apps/mobile/.env` for `expo start`; `eas.json` `env` per profile (`preview`, `production`) for cloud builds | RevenueCat **Apple App Store public SDK key** (`appl_…`). A **test-store** key (`test_…`) works for dev only. Empty → subscription UI hides and the app stays free-tier. | `apps/mobile/src/lib/purchases/config.ts` (inlined at build by Expo) |

> The entitlement identifier on mobile is the constant `REVENUECAT_ENTITLEMENT_ID`
> in `apps/mobile/src/lib/purchases/config.ts` (currently `"Sirius AI Pro"`). If you
> rename the entitlement, update **all three**: this constant, the server
> `REVENUECAT_ENTITLEMENT_ID`, and the dashboard.

> `EXPO_PUBLIC_*` is a PUBLIC key embedded in the app binary — safe to commit in
> `eas.json`. The webhook secret and DB URL are server-only — never `EXPO_PUBLIC_*`.

### Quick-start values for THIS app

- iOS bundle id: `dev.copt.sirius` (`apps/mobile/app.json`)
- Apple Team ID: `L7U86T3YRV`; App Store Connect app id: `6775729513` (`eas.json`)
- Entitlement identifier: `Sirius AI Pro` (all three products attach to it)
- Product ids (must match between App Store Connect and RevenueCat):
  - `subscription_monthly` — Auto-Renewable Subscription (Monthly)
  - `subscription_yearly` — Auto-Renewable Subscription (Annual)
  - `subscription_life` — Non-Consumable (Lifetime)
- Webhook URL (prod): `https://lesswhelmed.com/api/revenuecat/webhook`
- Webhook URL (local test): `http://localhost:3000/api/revenuecat/webhook`

---

## Configure RevenueCat for real (one-time, in order)

1. **App Store Connect — create the products.** Under your app → Subscriptions / In-App
   Purchases, create (these are the **live** product ids — they must match RevenueCat exactly):
   - Monthly — Auto-Renewable Subscription, product id `subscription_monthly`
   - Yearly — Auto-Renewable Subscription, product id `subscription_yearly`
   - Lifetime — Non-Consumable, product id `subscription_life`
   Put monthly + yearly in one Subscription Group. Fill **price + a localization (display
   name + description) + review info** on EACH product so they leave **"Missing Metadata"**
   and reach "Ready to Submit" (sandbox testing works before review). A product stuck on
   "Missing Metadata" is exactly what RevenueCat surfaces as a missing-product warning.
2. **App Store Connect — In-App Purchase key.** Users & Access → Integrations →
   In-App Purchase keys → generate one. RevenueCat needs it (key id + issuer id +
   `.p8`) to validate receipts and emit webhook events.
3. **RevenueCat — project + app.** Create a project, add an **App Store** app with
   bundle id `dev.copt.sirius`, and upload the In-App Purchase key from step 2.
4. **RevenueCat — products.** Add three products whose identifiers match the App Store
   product ids from step 1 **exactly**: `subscription_monthly`, `subscription_yearly`,
   `subscription_life`.
5. **RevenueCat — entitlement.** Create entitlement with identifier **`Sirius AI Pro`**
   (must match `REVENUECAT_ENTITLEMENT_ID`). Attach all three products to it.
6. **RevenueCat — offering.** Create the **default** offering; add packages Monthly /
   Annual / Lifetime → `subscription_monthly` / `subscription_yearly` / `subscription_life`.
   (The mobile paywall shows the default offering.)
7. **RevenueCat — paywall.** Open the Paywalls editor on the default offering and build
   it (this is the UI `RevenueCatUI.presentPaywall()` renders — designed in the
   dashboard, not in code). Match the Sirius paper-and-ink look.
8. **RevenueCat — Customer Center.** Enable it (shown by
   `RevenueCatUI.presentCustomerCenter()` from Settings → Manage subscription).
9. **RevenueCat — API key.** Project → API keys → copy the **Apple App Store public**
   key (`appl_…`) → set `EXPO_PUBLIC_REVENUECAT_IOS_KEY`.
10. **RevenueCat — webhook.** Project → Integrations → Webhooks. URL =
    `https://lesswhelmed.com/api/revenuecat/webhook`; set the **Authorization** header
    to the same string as `REVENUECAT_WEBHOOK_SECRET`. Send a test event → expect 200.

Then: set the server env (`REVENUECAT_WEBHOOK_SECRET`, optionally
`REVENUECAT_ENTITLEMENT_ID`/`AI_WEEKLY_LIMIT`), set
`EXPO_PUBLIC_REVENUECAT_IOS_KEY` in `apps/mobile/.env` (+ `eas.json` for builds),
and **rebuild the dev client** (the native module autolinks on prebuild; the
prebuild fingerprint already changed when the deps were added). The paywall UI
can't run in Expo Go.

---

## Paywall builder prompt (Sirius style)

Paste into RevenueCat's Paywall builder (its AI paywall generator, or use as a
hand-layout spec). Don't hardcode prices — the builder renders package
labels/cadence from your offering's App Store Connect prices. Map the three
packages to **Monthly / Annual / Lifetime** in the default offering and put the
"BEST VALUE" tag on **Annual**.

```
Design a subscription paywall for "Sirius AI Pro" — an editorial, literary
content-publishing app with a calm "paper-and-ink" aesthetic. Think a fine
printed journal, not a typical app paywall: restrained, generous whitespace,
hairline rules, nearly-square corners. NO gradients, NO drop shadows, NO glossy
rounded pills, NO emoji.

PALETTE
- Background: warm cream paper #f3ecdc
- Primary text / ink: near-black brown #1c1612
- Muted text: #5a4f43 ; subtle text: #897d6d
- Accent (use sparingly, for the selected plan + CTA): deep oxblood red #8b2e2a
  (darker press state #5a1c1a)
- Surfaces / cards: #eadfc6 with 1px hairline borders in a soft taupe

TYPOGRAPHY
- Headline: an elegant serif (Newsreader / Source Serif feel), large, tight leading
- Body: serif, readable, generous line height
- Micro-labels / eyebrows / price cadence: monospaced, UPPERCASE, ~10–11px,
  wide letter-spacing (~0.22em)

CONTENT (top to bottom)
1. Eyebrow (mono, uppercase): "SIRIUS AI PRO"
2. Headline (serif, large): "Unlimited AI drafts."
3. Sub-line (serif, muted): "Ingesting is always free. Pro lifts the weekly cap
   on AI-written posts."
4. A short feature list (serif, with thin oxblood tick marks):
   - "Unlimited AI-drafted posts"
   - "No weekly limit"
   - "Your words, written in your voice"
5. Three package options as squared cards with hairline borders (NOT pills):
   - Monthly
   - Annual — pre-selected, marked with an oxblood left border + a small mono
     "BEST VALUE" / "SAVE" tag
   - Lifetime — "one-time"
   Selected card: oxblood left border + faint cream-raised fill.
6. Primary CTA button: full-width, solid oxblood #8b2e2a, cream text,
   square-ish corners: "Start Sirius AI Pro"
7. Footer row (mono, tiny): "Restore" · "Terms" · "Privacy"
8. Closing line (serif italic, faint): "Cancel anytime in Settings."

TONE: confident, quiet, editorial. Let the cream paper and ink do the work;
oxblood is the only color and appears only on the selected plan and the CTA.
```

---

## Events → entitlement (what the webhook does)

`applyRevenueCatEvent` only reacts to events carrying the `Sirius AI Pro`
entitlement, and is idempotent/ordered via `lastEventId` / `lastEventAt`:

- **Pro on** (`isPro=true`, `expiresAt` from the event): `INITIAL_PURCHASE`,
  `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE` (lifetime),
  `SUBSCRIPTION_EXTENDED`, `TRANSFER`.
- **Pro off**: `EXPIRATION`.
- **No flip** (access continues until `expiresAt`, which `checkProStatus` enforces):
  `CANCELLATION`, `BILLING_ISSUE`.

A missed `EXPIRATION` self-heals: `checkProStatus` treats a past `expiresAt` as
not-Pro. Lifetime has no `expiresAt` → permanent (intended).

---

## Verifying

- **Quota (no RevenueCat needed):** as a free user submit 10 server drafts
  (on-device curation OFF) → all PUBLISHED; the 11th → a DRAFT stub (check
  `bun run db:studio`: `Post.status=DRAFT`, submission `completed`,
  `AiGenerationEvent` count = 10). Set `UserEntitlement.isPro=true` → the 11th
  drafts normally.
- **Webhook:** `POST /api/revenuecat/webhook` with the `Authorization` secret and a
  sample `INITIAL_PURCHASE` body (`event.app_user_id` = a real `User.id`,
  `event.entitlement_ids` includes `Sirius AI Pro`) → `isPro` flips true. Replay the
  same `event.id` → ignored.
- **Usage API:** `GET /api/app/usage` → `{ used, limit, remaining, isPro, resetsAt }`.
- **Mobile (after rebuild + key set):** Settings shows the usage meter + Upgrade
  (paywall) / Manage (Customer Center); the composer shows the meter and prompts the
  paywall at the limit. A sandbox purchase flips entitlement live.

## Comp / manual Pro grant (no purchase)

Unlock "Sirius AI Pro" for yourself, the team, or a support comp without going
through RevenueCat. Writes `UserEntitlement` directly (`store=MANUAL_GRANT`); the
worker honors it via `checkProStatus`. Idempotent.

```sh
bun run pro:grant you@example.com                    # lifetime grant
bun run pro:grant a@x.com b@y.com                     # several at once
bun run pro:grant you@example.com --expires 2027-01-01  # time-boxed
bun run pro:grant you@example.com --revoke              # turn Pro OFF
```

On **prod**, run it on the server (where the prod `.env` with `DATABASE_URL`
lives — the same host `deploy.sh` runs on), e.g. over SSH from the repo dir.
Unknown emails print `✗` and the command exits non-zero, but valid ones still
apply. Verify with `bun run db:studio` (UserEntitlement) or re-run — it's safe.
Source: `scripts/grant-pro.ts` → `setProEntitlement` (`packages/db/src/entitlement.ts`).

## Notes

- No dedicated `verify:revenuecat` build gate: RevenueCat autolinks as a standard
  native module (unlike llama.rn's JSI bridge it has no silent-no-op mode), and the
  prebuild fingerprint (`scripts/prebuild-if-native-changed.mjs`, hashes
  `apps/mobile/package.json`) already forces a clean prebuild when deps change. The
  runtime `nativeReady()` guard in `purchases/index.ts` makes the app no-op (not
  crash) if a binary is ever stale.
- Web has no purchase flow — purchases are iOS/App Store only. Web shows usage
  (`/api/app/usage`, surfaced on Settings via `AiUsageCard`); upgrade/manage happen
  in the app.
