# Runbook — resubmit subscriptions & IAP to Apple

Operator checklist + copy-paste **Review Notes** for each product, for getting the
in-app purchases attached to and submitted with the next iOS binary.

> **Cross-refs:** `APP_STORE_SUBMISSION.md` §0b (subscription rejection `d1343e4d`,
> Guideline 2.1(b) + 3.1.2(c)) and §12 (prepared Resolution Center reply);
> `docs/HANDOFF-revenuecat.md` (product IDs, entitlement, RevenueCat setup);
> `RESUBMIT-RUNBOOK.md` (the UGC resubmission this rides along with).

---

## Context — why "resubmit" is needed

- The **subscription/IAP rejection (`d1343e4d`, Guideline 2.1(b) + 3.1.2(c)) was already
  fixed** and did **not** come back in the 2026-07-03 review (build 72). See §0b.
- The **current live blocker is UGC / age rating** (`2c02b4c2`, Guideline 1.2 + 2.3.6) —
  see `APP_STORE_SUBMISSION.md` §0 and `RESUBMIT-RUNBOOK.md`.
- Because a **new binary is required for the UGC fix**, the IAPs must be **re-attached to
  and submitted *with* that new version**. A first-time / previously-rejected IAP does not
  ride along automatically — if a product sits in "Missing Metadata" or "Developer Action
  Needed," Apple can re-reject on the subscription even with UGC fixed
  (`RESUBMIT-RUNBOOK.md` step 5 gates on this).

---

## My actual product structure (confirmed)

All three grant the same `Sirius AI Pro` entitlement (unlimited **server** AI drafting;
free tier is ~10 server drafts/week; on-device drafting is always free; capture / review /
keep / export are never gated).

| Product ID | Type | Grouping |
| --- | --- | --- |
| `subscription_life` | **Non-Consumable** (Lifetime, one-time) | Standalone IAP |
| `subscription_monthly` | Auto-Renewable Subscription (Monthly) | **Subscription Group** |
| `subscription_yearly` | Auto-Renewable Subscription (Annual) | **Same Subscription Group** |

- ✅ **Yes:** one non-consumable IAP (`subscription_life`) + **one Subscription Group**
  holding the monthly and yearly auto-renewables. That's the correct structure.

---

## What to do (App Store Connect — per product)

For **each** product, get it out of "Missing Metadata" → **"Ready to Submit,"** then attach
it to the app version:

1. **Localization** — display name + description (Lifetime / Monthly / Annual).
2. **Price** — set the tier (pricing anchors: Pro **$8/mo**, **$72/yr**; Lifetime TBD —
   see `docs/launch/business/01-pricing-and-packaging.md`).
3. **Subscription review screenshot** (mandatory) — a clean shot of the paywall (title,
   price, Upgrade button). **Best path:** capture the real paywall from the running app on
   the iOS Simulator — one capture doubles as the 3.1.2(c) screen recording (see §0b note
   "the IAP review screenshot vs. the screen recording").
4. **Review Notes** — paste the per-product text below into the product's Review Notes field.
5. **Grouping** — Monthly + Annual live in one Subscription Group; Lifetime is a standalone
   non-consumable.
6. Move each to **Ready to Submit** and **attach all three to this app version** so they are
   submitted **together with** the new binary.

### RevenueCat dashboard (last open §0b item)

- Confirm the **paywall footer Terms + Privacy links** are enabled on the default offering:
  - Privacy → `https://lesswhelmed.com/privacy`
  - Terms → `https://lesswhelmed.com/terms` (our Terms of Use page, which itself references
    Apple's standard EULA — so 3.1.2(c) is preserved; see `APP_STORE_SUBMISSION.md` §0 Part A step 4)
- These make the **in-app** 3.1.2(c) disclosures functional with no app-code change.
- The always-visible Privacy/Terms links on the in-app Subscription card
  (`apps/mobile/src/components/subscription-section.tsx`) already ship as a belt-and-
  suspenders backup.

---

## Per-product Review Notes (paste into each product's "Review Notes" field)

### Lifetime — `subscription_life`

```text
Product: Sirius AI Pro (Lifetime), non-consumable one-time purchase. Grants the "Sirius AI Pro" entitlement permanently — unlimited server-side AI drafting, no recurring charge. Free users get ~10 AI drafts/week; this removes the cap for good. Capture, review, keep, and export are always free.

How to reach the purchase flow: sign in with the demo account in App Review Information → Account (Settings) tab → "Subscription" section → tap Upgrade; the Lifetime option appears as a one-time package in the paywall alongside Monthly/Annual. The paywall shows title, "one-time" terms, price, and functional Privacy Policy and Terms of Use links. Test purchases use the sandbox.

Disclosures (Guideline 3.1.2(c)): Privacy https://lesswhelmed.com/privacy ; Terms of Use https://lesswhelmed.com/terms (references the standard Apple EULA). Restore Purchases is available in the paywall footer and via Settings → Manage subscription (RevenueCat Customer Center). No functionality requires purchase; Pro only lifts the AI-draft cap.
```

### Monthly — `subscription_monthly`

```text
Product: Sirius AI Pro (Monthly), auto-renewable. Grants the "Sirius AI Pro" entitlement — unlimited server-side AI drafting of captures. Free users get ~10 AI drafts/week; Pro removes that cap. Capturing, reviewing, keeping, and exporting content are always free and never gated.

How to reach the purchase flow: sign in with the demo account in App Review Information → Account (Settings) tab → "Subscription" section → tap Upgrade, OR the composer prompts it at the weekly limit. The paywall (RevenueCat) shows title, length (monthly), price, and functional Privacy Policy and Terms of Use links. Test purchases use the sandbox.

Disclosures (Guideline 3.1.2(c)): Privacy Policy https://lesswhelmed.com/privacy ; Terms of Use https://lesswhelmed.com/terms (references the standard Apple EULA) — both linked in the paywall footer and on the in-app Subscription card. No functionality requires purchase; Pro only lifts the AI-draft cap.
```

### Annual — `subscription_yearly`

```text
Product: Sirius AI Pro (Annual), auto-renewable. Same entitlement as the monthly plan — unlimited server-side AI drafting — billed yearly (best value). Free users get ~10 AI drafts/week; Pro removes the cap. Capture, review, keep, and export are always free.

How to reach the purchase flow: sign in with the demo account → Account (Settings) → "Subscription" → Upgrade (or the composer prompts at the weekly limit). The paywall shows title, length (annual), price, and functional Privacy Policy and Terms of Use links. Sandbox for test purchases.

Disclosures (Guideline 3.1.2(c)): Privacy https://lesswhelmed.com/privacy ; Terms of Use https://lesswhelmed.com/terms (references the standard Apple EULA) — both in the paywall footer and the in-app Subscription card. No feature is locked behind purchase beyond the AI-draft volume cap.
```

---

## Resolution Center reply (subscription guideline, if cited again)

Prepared text (matches `APP_STORE_SUBMISSION.md` §12, both use `https://lesswhelmed.com/terms`,
which references the standard Apple EULA):

```text
Guideline 2.1(b) — In-App Purchase submitted. The subscriptions "Sirius AI Pro" (monthly and annual auto-renewable) and the "Sirius AI Pro Lifetime" non-consumable now have complete metadata and a review screenshot, are in the "Ready to Submit" state, and have been attached to this version so they are submitted together with this new binary for review.

Guideline 3.1.2(c) — Subscription information. The required information is now present in both the app and the metadata:
- In the purchase flow (paywall): the subscription title, length, and price are displayed, along with functional links to our Privacy Policy (https://lesswhelmed.com/privacy) and our Terms of Use (https://lesswhelmed.com/terms), which references the standard Apple Terms of Use (EULA).
- In the App Store metadata: the Privacy Policy field links to https://lesswhelmed.com/privacy, and the App Description includes a functional link to our Terms of Use (https://lesswhelmed.com/terms).
A screen recording of the purchase flow showing the title, length, price, and both functional links is included in the App Review Information Notes.
```

---

## Checklist

- [ ] `subscription_life` — localization + price + review screenshot + Review Notes → Ready to Submit
- [ ] `subscription_monthly` — localization + price + review screenshot + Review Notes → Ready to Submit
- [ ] `subscription_yearly` — localization + price + review screenshot + Review Notes → Ready to Submit
- [ ] Monthly + Annual confirmed in **one Subscription Group**; Lifetime standalone
- [ ] All three **attached to the app version** (submitted with the new binary)
- [x] RevenueCat paywall **footer Terms + Privacy links** enabled (Privacy → `/privacy`, Terms → `/terms`) — confirmed set
- [ ] Verify the footer links open live on the presented paywall (running app, not the dashboard preview)
- [ ] App Description includes Privacy + Terms links; ASC Privacy Policy field = `https://lesswhelmed.com/privacy`
- [ ] New iOS build + submit (`cd apps/mobile && bunx eas-cli build --profile production --platform ios` → `bunx eas-cli submit --profile production --platform ios --latest`)
- [ ] Paywall screen recording attached in App Review Information → Notes
- [ ] Resolution Center reply pasted (if the subscription guideline is cited)
```
