# Sirius — Pricing & Packaging

_How we package the life-context engine, and what each tier unlocks. Last updated 2026-06-29._

> Pricing follows the brand: calm, honest, no dark patterns. The free tier is
> genuinely useful; Pro removes the AI-draft ceiling and unlocks the corpus's
> full power. Forward-looking tiers (Team/Pro+, automation metering) are clearly
> marked **roadmap**. Conversion/MRR modeling lives in
> [`02-financial-assumptions.md`](./02-financial-assumptions.md); the business
> rationale lives in [`00-business-model-canvas.md`](./00-business-model-canvas.md).

---

## The packaging principle

Sirius monetizes the **volume and reach of AI work over your corpus**, never the
ability to keep or export your own data. You can always capture, review, keep,
and **export everything** — even on Free. What scales with price is **how much
AI drafting you get**, **how far your corpus reaches** (API/MCP, automation),
and **collaboration surface** (groups/teams).

> Honesty rule: features below the line in the gate table marked _roadmap_ are
> **not shipped**. Do not sell them as live. The Automation Engine / "closing
> the loop" is north star, not today.

---

## Tiers

| | **Free** | **Pro** _(today)_ | **Team / Pro+** _(roadmap)_ |
| --- | --- | --- | --- |
| Who it's for | Trying Sirius; light capture | The committed individual | Small teams + power users |
| Price (ASSUMPTION) | $0 | **$8/mo** or **$72/yr** (~25% off → ~$6/mo) | **~$16/user/mo** (annual-led) |
| AI drafts (server) | ~10 / week _(cap)_ | Unlimited (fair-use) | Unlimited + shared pool |
| On-device drafting (iPhone) | ✅ Unlimited (it's free to us) | ✅ Unlimited | ✅ |
| Everything-export / archive | ✅ | ✅ | ✅ |

Annual is the headline lever (cash up front, lower churn, smaller relative
store-cut drag). Pricing is an **ASSUMPTION to validate** — anchored below.

---

## Feature gate table

| Capability | Free | Pro | Team/Pro+ _(roadmap)_ |
| --- | :---: | :---: | :---: |
| Capture anything (links, photos, notes, repos, YouTube, docs, voice) | ✅ | ✅ | ✅ |
| iOS Share Sheet capture | ✅ | ✅ | ✅ |
| **AI drafting — server (Gemini)** | ~10/week | Unlimited¹ | Unlimited¹ |
| **AI drafting — on-device (iPhone)** | ✅ | ✅ | ✅ |
| Review-before-keep | ✅ | ✅ | ✅ |
| Catalog (private library, draft → published) | ✅ | ✅ | ✅ |
| Public catalog `/catalog/[handle]` | ✅ | ✅ | ✅ |
| Queue (live state machine) | ✅ | ✅ | ✅ |
| **Curated search** (FTS + embeddings, RRF) | Basic² | Full | Full |
| **The Tree / Observatory** (meaning map, 3D space) | Preview³ | Full | Full |
| **Friends + per-post visibility** (PRIVATE/FRIENDS/PUBLIC) | ✅ | ✅ | ✅ |
| **Named friend-Groups (GROUP audience)** | View/join | ✅ Create | ✅ + team groups |
| **Retain originals (private)** | ✅ | ✅ | ✅ |
| **Full export / archive (emailed)** | ✅ | ✅ | ✅ |
| **MCP corpus server / per-user API key** | — | ✅ | ✅ + higher limits |
| Priority pipeline (faster drafting) | — | ✅ | ✅ |
| Team seats / shared admin | — | — | ✅ |
| **Insight Engine** (Opportunity Dashboard, connect-the-dots) _(roadmap)_ | — | Included when shipped | ✅ |
| **Automations / "the Loop"** _(roadmap)_ | — | Limited runs | **Usage-metered** |

¹ "Unlimited" = fair-use; abuse/automation throttled. ² Free search may cap
result depth or scope. ³ Free Tree may limit drill-depth. Free/Pro split lines
are **ASSUMPTIONS to validate** — the only hard rules are: on-device drafting is
always free, and export is never paywalled.

**Why those gates:** the costs are gated, not the freedoms. Server AI drafting,
MCP/API reach, priority pipeline, and (future) automation all consume real
Gemini/compute spend — so they sit behind Pro. Ownership (retain + export) and
basic capture stay free because they're the trust contract and cost us little.

---

## Price anchoring & rationale

| Anchor | Price | Read |
| --- | --- | --- |
| Notion AI | ~$10/user/mo add-on | Sirius Pro should sit **at or just under** — we're a focused engine, not a suite tax. |
| Readwise Reader | ~$8–10/mo | Direct prosumer-capture comp; **$8 is the credible anchor.** |
| Rewind/Limitless | ~$20+/mo | Premium recall comp; leaves headroom for **Pro+/automation** later. |
| ChatGPT Plus | ~$20/mo | Sets the "AI subscription" mental price; Pro at $8 reads as easy-yes. |

**Decision (ASSUMPTION): Pro = $8/mo / $72/yr.** Below the ChatGPT/Notion
reference points (easy yes), at the Readwise band (credible for capture),
with explicit headroom above for Pro+/Team and usage-metered automation.

---

## Trial, discounts & parity

- **Free trial:** 7-day Pro trial via RevenueCat (App Store / Play standard).
  The Free tier itself is the real "trial" — no time pressure, just the AI-draft
  cap. (Trial length is an ASSUMPTION to test against conversion.)
- **Annual discount:** ~25% off vs monthly. Pushes annual (better cash, churn,
  and store-cut math).
- **App Store vs web parity:** same feature set everywhere. Where store rules
  permit, **web checkout** avoids the 15–30% platform cut — steer high-intent
  users there without degrading the in-app experience. Maintain price parity to
  avoid confusion; capture the margin on the rails, not the sticker.
- **Education / launch promos:** candidate, not committed.

---

## Mechanism

- Subscriptions run through the **in-repo RevenueCat paywall** (entitlements +
  receipt validation across iOS/Android, web checkout alongside). RevenueCat is
  the source of truth for entitlement state the app gates on.
- The current ship-state gate is the **free AI-draft cap** (ASSUMPTION ~10/week)
  enforced server-side; on-device drafts bypass the cap because they cost us
  nothing.

---

## Future: usage-based pricing for automation _(roadmap)_

When the **Automation Engine** ships ("closing the loop": one-click suggested
actions + if-this-then-that Automations), pricing shifts from pure
seat-subscription toward a **hybrid**: subscription for the context/insight
layer, **metered usage** for automation runs that consume real compute and take
action on the user's behalf. This aligns price with the value (and cost) of
action, and is where the model expands beyond a flat Pro fee. **Not shipped —
do not sell as live.**

---

## Open questions to validate

1. Is **$8** the right Pro point, or does the on-device/ownership story support
   $10–12?
2. Is **~10 drafts/week** the right free ceiling — generous enough to convert,
   tight enough to bound Gemini cost?
3. Does **MCP/API access** belong in Pro or its own developer tier?
4. What's the right **annual discount** to maximize LTV without over-discounting?

All four are explicit assumptions; see
[`02-financial-assumptions.md`](./02-financial-assumptions.md).
