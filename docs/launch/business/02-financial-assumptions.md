# Sirius — Financial Assumptions (Year 1)

_A labeled assumptions model, not a forecast. Last updated 2026-06-29._

> **Read this first.** Every number below is an **ASSUMPTION to be validated**,
> not a projection. The point is to make the model's levers explicit so we can
> falsify them with real data fast. Pricing context:
> [`01-pricing-and-packaging.md`](./01-pricing-and-packaging.md). Cost structure:
> [`00-business-model-canvas.md`](./00-business-model-canvas.md). Round numbers
> on purpose — precision here would be false confidence.

---

## A. Per-user variable cost assumptions

Reference price: **Pro = $8/mo** (or $72/yr).

| Driver | Assumption | Notes |
| --- | --- | --- |
| Server AI drafts / active Pro user | ~120 / month | Free is capped at ~10/week (~40/mo). |
| Cost per server draft (Gemini, in+out+embedding) | **~$0.01** | ASSUMPTION; depends on model + token mix. |
| **On-device draft share** (iPhone) | ~40% of Pro drafts | ~$0 marginal to us — the key margin lever. |
| Effective server drafts / Pro / mo | ~72 (120 × 60%) | → **~$0.72/mo** Gemini cost per Pro user. |
| Infra (Postgres, VPS, Caddy, email, storage) / active user | **~$0.15/mo** | Mostly fixed; amortized per active user. |
| Apify (Instagram path) | negligible / avg user | Only fires on Instagram captures. |
| **Total variable cost / Pro / mo (pre-store-cut)** | **~$0.90** | Gemini + infra. |

**Revenue-side leakage (not a "cost" but margin drag):**

| Leakage | Assumption |
| --- | --- |
| App-store cut (blended, mix of monthly/annual/web) | **~20%** of subscription revenue |
| RevenueCat fee (above free threshold) | ~1% of tracked revenue |

**Net revenue per Pro user (monthly):** $8 − ~20% store cut − ~1% RC ≈ **$6.30**.
Minus ~$0.90 variable cost → **~$5.40 contribution / Pro / mo (~68% margin)** at
the monthly price; annual improves it (lower blended store cut + churn).

> Sensitivity flag: the two numbers that move everything are **cost per draft**
> and **on-device share**. If on-device share rises to 60%, server Gemini cost
> per Pro drops to ~$0.48/mo; if cost-per-draft is 3× our guess, variable cost
> still stays under ~$1.40 — margin stays healthy. The model is **margin-robust
> because of on-device AI.**

---

## B. Funnel & conversion assumptions

| Stage | Assumption | Note |
| --- | --- | --- |
| Install → activated (first kept post) | ~45% | Onboarding teaches the Share-Sheet move. |
| Activated → retained (D30) | ~35% | Corpus + ownership = switching cost. |
| Free → Pro conversion | **~4%** | ASSUMPTION; prosumer SaaS band ~2–6%. |
| Trial → paid (of trial starts) | ~40% | 7-day Pro trial. |
| Monthly churn (Pro) | ~5% | → ~46% annual logo churn; annual plans lower it. |
| Annual mix of Pro | ~40% | Push via discount; improves cash + churn. |
| Blended ARPU (Pro) | ~$7/mo effective | Monthly+annual blend before store cut. |

---

## C. Year-1 scenarios

Driver = total registered users by end of Year 1, at ~4% paid conversion
(except upside, which assumes better conversion from the on-device/ownership
story). MRR uses ~$6.30 **net** revenue per Pro user (post store cut + RC).

| | **Conservative** | **Base** | **Upside** |
| --- | --- | --- | --- |
| Registered users (EOY1) | 10,000 | 40,000 | 120,000 |
| Free → Pro conversion | 3% | 4% | 6% |
| **Paying (Pro) users** | **300** | **1,600** | **7,200** |
| Gross MRR (@ $8 list) | $2,400 | $12,800 | $57,600 |
| **Net MRR** (≈$6.30/user) | **~$1,900** | **~$10,100** | **~$45,400** |
| Net ARR (run-rate, EOY1) | ~$23K | ~$121K | ~$545K |
| Variable cost / mo (Pro @ ~$0.90) | ~$270 | ~$1,440 | ~$6,480 |
| **Gross margin** (after variable + store cut, on net rev) | **~65–70%** | **~68%** | **~70%** |

> Note: Free users also carry a real (small) cost — server drafts up to the cap
> + infra. At ~$0.55/mo per active free user and large free bases, this is a
> **second sensitivity**: in upside, ~113K free users could cost ~$60K/yr. The
> free AI-draft cap exists precisely to bound this; **validate the cap against
> real free-user draft volume early.**

---

## D. CAC / LTV sketch

| Input | Assumption |
| --- | --- |
| Pro lifetime | ~20 months (at ~5% blended monthly churn) |
| Net revenue / Pro / mo | ~$6.30 |
| Variable cost / Pro / mo | ~$0.90 |
| Contribution / Pro / mo | ~$5.40 |
| **LTV (contribution × lifetime)** | **~$108** |
| Target CAC (LTV:CAC ≥ 3:1) | **≤ ~$36** |

**CAC posture:** early growth should lean on **near-zero-CAC channels** — iOS
Share Sheet, public catalogs (SEO), and the invite/Friends graph — keeping
blended CAC well under the ~$36 ceiling. Paid acquisition only makes sense once
activation + D30 retention are validated; otherwise we'd buy users who churn
before the corpus (and its compounding context) locks them in.

---

## E. Sensitivity note (what to watch, in priority order)

1. **On-device draft share** — the master margin lever. Higher share → lower
   Gemini spend → margin improves at scale. Instrument it from day one.
2. **Free → Pro conversion** — the master revenue lever. A 4% → 6% move (the
   conservative-to-upside gap) ~1.5×'s paying users at the same top of funnel.
3. **Cost per server draft** — our $0.01 is a guess; track actuals. Even a 3×
   miss keeps margins >60% given on-device offload + the free cap.
4. **Free-user cost drag** — bounded by the draft cap; revisit the cap if free
   inference spend approaches paid contribution.
5. **Store-cut mix** — annual + web checkout reduce the blended cut from ~30%
   toward ~15–20%; this directly lifts net MRR with no product change.

---

## F. What this model is NOT

- Not a forecast or a promise — a **falsifiable set of assumptions**.
- Not a fundraising plan — no headcount, burn, or runway here.
- Not load-bearing on roadmap revenue — **automation/usage-based pricing is
  excluded** (it's north star, not shippable Year-1 revenue). When the
  Automation Engine ships, a metered line gets added and this model is re-cut.

**Next step:** wire RevenueCat + product analytics to replace each ASSUMPTION
above with a measured value, starting with on-device share and free→Pro
conversion.
