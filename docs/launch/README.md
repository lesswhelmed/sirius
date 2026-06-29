# Sirius — Launch Doc Set

_The single home for the Sirius rebrand + business-launch materials. Last updated 2026-06-29._

> **Sirius is the life-context engine.** You capture anything — links, photos, notes,
> repos, videos, voice — and Sirius turns it into private _context about your life_:
> your aspirations, projects, and inputs. That context is what lets Sirius **close the
> loop** — from scattered inputs to drafts, organization, and (increasingly) action,
> on your terms.
>
> **Sirius** is the brand. **lesswhelmed.com** is the home. **Feel lesswhelmed.**

---

## How to use this set

These documents are the source of truth for the rebrand. The **brand spine** below is
the one paragraph every other doc inherits; if a doc ever contradicts the spine, the
spine wins. Start with `brand/00-brand-strategy.md`, then read by need:

- **Shipping marketing copy?** → `product/03-launch-copy.md` + `brand/01-messaging-framework.md`
- **Building UI / assets?** → `brand/02-visual-identity.md` + `brand/03-naming-nomenclature.md`
- **Pitching / fundraising?** → `product/01-one-pager.md` + `gtm/00-market-research.md` + `business/00-business-model-canvas.md`
- **Launching?** → `gtm/03-go-to-market-plan.md` + `gtm/04-launch-announcement.md`

## Index

### `brand/` — the brand bible
| Doc | What it covers |
| --- | --- |
| [`00-brand-strategy.md`](brand/00-brand-strategy.md) | Positioning thesis, brand architecture (Sirius hero / lesswhelmed promise), the name + cat/star story, pillars, personality, the moat |
| [`01-messaging-framework.md`](brand/01-messaging-framework.md) | Positioning statement, value pyramid, taglines, elevator pitches, message house, voice & tone, lexicon, objection handling |
| [`02-visual-identity.md`](brand/02-visual-identity.md) | Wordmark, the cat icon, full color system (real hex), typography, the zero-radius editorial system, accessibility |
| [`03-naming-nomenclature.md`](brand/03-naming-nomenclature.md) | Canonical names for the company, product, surfaces, features & tiers; capitalization & "lesswhelmed" usage rules |

### `gtm/` — market & go-to-market
| Doc | What it covers |
| --- | --- |
| [`00-market-research.md`](gtm/00-market-research.md) | Category definition, market sizing (sourced), trends, where Sirius fits |
| [`01-competitive-landscape.md`](gtm/01-competitive-landscape.md) | Competitor matrix (Notion AI, Mem, NotebookLM, Obsidian, Rewind/Limitless…), differentiation, moats, risks |
| [`02-positioning-and-icp.md`](gtm/02-positioning-and-icp.md) | Positioning statement, broad-prosumer strategy, three personas + JTBD |
| [`03-go-to-market-plan.md`](gtm/03-go-to-market-plan.md) | Objectives & KPIs, funnel, channels, launch timeline, growth loops, risks |
| [`04-launch-announcement.md`](gtm/04-launch-announcement.md) | Ready-to-ship Product Hunt / Show HN / social / email / App Store launch copy |

### `business/` — model, pricing, money
| Doc | What it covers |
| --- | --- |
| [`00-business-model-canvas.md`](business/00-business-model-canvas.md) | Full BMC grounded in the real stack costs |
| [`01-pricing-and-packaging.md`](business/01-pricing-and-packaging.md) | Free / Pro / future tiers, feature-gate table, price rationale, RevenueCat paywall |
| [`02-financial-assumptions.md`](business/02-financial-assumptions.md) | Lightweight, clearly-flagged assumptions model — unit economics + Y1 scenarios |

### `product/` — vision & narrative
| Doc | What it covers |
| --- | --- |
| [`00-product-vision.md`](product/00-product-vision.md) | The Life Context thesis, the close-the-loop arc, ships-today vs north star, principles, the moat |
| [`01-one-pager.md`](product/01-one-pager.md) | Single-page press/investor/partner brief |
| [`02-faq.md`](product/02-faq.md) | User + press FAQ (differentiation, privacy, on-device, pricing, export, roadmap) |
| [`03-launch-copy.md`](product/03-launch-copy.md) | Refreshed web homepage + App Store listing copy |

---

## The brand spine (authoritative)

- **Brand architecture:** "Sirius" is the single hero brand — product **and** company.
  "Lesswhelmed" survives only as the domain (`lesswhelmed.com`) and the emotional
  **promise** ("Feel lesswhelmed"). Never a co-brand.
- **Central thesis:** Sirius is the **life-context engine**. Capture → private life
  context → close the loop.
- **Audience:** broad prosumer; lead with "capture anything, get something worth
  keeping" and let segments self-select.
- **Name + symbol:** Sirius = the brightest star, a fixed point amid overwhelm; the cat
  = sees in the dark, finds signal in clutter, "lets the cat out of the bag."
- **Category wedge:** everyone else builds a second brain (capture + recall); Sirius
  builds your **life context** and uses it to take **action** — the layer between PKM
  and ambient agents.
- **Honesty rule:** automation / closing-the-loop is the **north star**, not a shipped
  claim. Marketing claims = what ships today (capture → AI draft → review → catalog,
  on iOS + web, with on-device drafting on iPhone).

## Scope note

This set is **documentation only**. Wiring the live surfaces to match — the marketing
pages (`apps/web/app/(marketing)`), `constants.ts`, the app `README`, and App Store
metadata — is a separate, follow-up pass.

## Provenance

- Prior brand material this set supersedes/absorbs: [`../marketing/selling-points.md`](../marketing/selling-points.md),
  [`../../initial-vision.md`](../../initial-vision.md) (the 4-phase "Closing the Loop" arc),
  [`../vision/`](../vision/).
- Market & category claims are grounded in third-party 2026 sources (cited inline in
  `gtm/00-market-research.md`).
