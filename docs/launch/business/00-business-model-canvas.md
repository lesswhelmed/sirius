# Sirius — Business Model Canvas

_The life-context engine, as a business. Last updated 2026-06-29._

> **Brand spine:** Sirius is the life-context engine. You capture anything; it
> becomes private context about your life; that context lets Sirius close the
> loop — from scattered inputs to drafts, organization, and (increasingly)
> action, on your terms. Brand line: **"Your life, in context."** Promise:
> **"Feel lesswhelmed."**

This canvas is a working operating document, not a pitch slide. It separates
what **ships today** from the **north-star roadmap**, and grounds the cost
structure in the real stack. Every forward-looking number lives in
[`02-financial-assumptions.md`](./02-financial-assumptions.md); pricing detail
lives in [`01-pricing-and-packaging.md`](./01-pricing-and-packaging.md).

---

## 1. Value propositions

| For whom | The job | What Sirius does **today** | The north-star payoff |
| --- | --- | --- | --- |
| Everyone (universal hook) | "I capture things and lose them." | Capture anything — link, photo, screenshot, note, repo, YouTube, document, voice memo — and get back a clean, structured, reviewable post. | "Capture now. Sorted later." becomes "Capture now. Sirius acts later." |
| The overwhelmed professional | Too many inputs, no time to organize. | AI drafting + auto-classification + a live queue, so nothing is lost and nothing demands manual filing. | An Opportunity Dashboard that tells you what to act on. |
| The second-brain power user | Wants a corpus that is theirs and queryable. | The Tree/Observatory (meaning map), curated search (full-text + embeddings), MCP corpus server, full export. | Connect-the-dots surfacing across the entire private corpus. |
| The creator | Drafts and publishes from scattered sources. | Public catalog at `/catalog/[handle]`, Friends hub + shared feed, per-post visibility. | Automations that turn a finding into a published artifact. |

**The single sentence:** _Everything you capture, drafted into something worth
keeping — and, over time, a system that understands your goals and helps close
the loop._

**Differentiators that are real today**

- **On-device drafting** (llama.rn on iPhone): drafting can run entirely on the
  phone — private, no server round-trip. This is also a **variable-cost lever**
  (see cost structure).
- **Ownership**: every uploaded original is retained privately; one-tap full
  export/archive, emailed as a download. No third-party ads, no cross-app tracking.
- **Open context**: the MCP corpus server lets the user point _their chosen_ AI
  tools at _their_ corpus via a per-user API key.

**North-star (label clearly as not-yet-shipped):** the Insight Engine
(Opportunity Dashboard, connect-the-dots) and the Automation Engine (one-click
suggested actions, if-this-then-that Automations). The moat is **compounding
Life Context** — competitors store; Sirius understands and acts.

---

## 2. Customer segments

Broad **prosumer**. Lead with the universal hook and let segments self-select.

- **Primary (paying early):** second-brain power users and overwhelmed
  professionals who already feel the pain of scattered capture and will pay to
  stop losing things.
- **Secondary:** creators who publish, and privacy-conscious users drawn to
  on-device drafting + data ownership.
- **Adjacent / developer wedge:** people who live in AI tools and want their own
  corpus available over MCP.
- **Free, non-converting (still valuable):** casual capturers — they seed
  word-of-mouth, public catalogs, and the Friends graph (network effects).

Not targeting (today): regulated-enterprise/team admin buyers. That is a
post-Team-tier motion.

---

## 3. Channels

| Channel | Stage | Notes |
| --- | --- | --- |
| Apple App Store (iOS) | Live | Store name **Sirius**. Primary acquisition + billing rails. |
| Web app (`lesswhelmed.com`) | Live | Full product; web checkout avoids the store cut where allowed. |
| iOS Share Sheet | Live | "Share anything into Sirius, no app-switching" — a product-led growth surface, not just a feature. |
| Public catalogs (`/catalog/[handle]`) | Live | Each published catalog is an SEO + referral surface. |
| Friends hub + invite cards | Live | Per-user invite (OG card + QR + public `/u/<handle>`) drives viral, in-graph growth. |
| Google Play (Android) | Build exists in EAS | Channel opens when Android ships. |
| MCP ecosystem (`mcp.lesswhelmed.com`) | Live | Developer/AI-tool distribution; per-user API keys. |
| Content / category narrative | Planned | Ride the 2026 "context engineering / memory layer" wave. |

---

## 4. Customer relationships

- **Self-serve, low-touch.** Onboarding teaches the Share-Sheet move (the
  `/help` hub doubles as first-run onboarding). The product should feel calm;
  support volume should stay low by design.
- **Review-before-keep trust contract.** The user always reviews AI drafts
  before anything is kept. This is the relationship anchor — Sirius proposes,
  the user decides ("AI drafts it. You decide what's worth keeping.").
- **Ownership as retention.** Retained originals + one-tap export means users
  trust Sirius with the long haul; the corpus (and its compounding context) is
  the switching cost.
- **Community surface.** Friends/Groups/shared feed create soft social
  retention without turning the product into a social network.

---

## 5. Revenue streams

| Stream | Status | Mechanism |
| --- | --- | --- |
| **Pro subscription** | Live | RevenueCat-backed subscription; monthly + annual. App Store / Play / web. |
| **Free tier** | Live | AI-draft cap (ASSUMPTION for modeling: ~10 AI drafts/week). Drives funnel + network effects. |
| **Team / Pro+** | Roadmap | Higher seats, shared groups at scale, admin. |
| **Usage-based automation** | Roadmap | When the Automation Engine ships, metered pricing for actions/runs that consume real compute. |
| **MCP / API access tier** | Candidate | Gate heavier programmatic corpus access behind a paid tier. |

Billing detail, anchors, and gates: see
[`01-pricing-and-packaging.md`](./01-pricing-and-packaging.md). Conversion and
MRR modeling: see [`02-financial-assumptions.md`](./02-financial-assumptions.md).

---

## 6. Key resources

- **The corpus + Life Context** (the compounding asset and the moat).
- **The ingest pipeline** (web submit → DB queue → worker → Gemini → Postgres),
  the Tree/Observatory, curated search, and the on-device llama.rn bridge.
- **Brand + identity**: the Sirius wordmark, the cat-in-the-bag icon, the
  editorial design system (`lesswhelmed.com`).
- **Infra**: Postgres (Prisma 7 + pgvector-style embedding search), Caddy media
  serving, EAS build/OTA, RevenueCat.
- **Team** (small) and the accumulated, hard-won operational knowledge
  (on-device AI, EAS, deploy).

---

## 7. Key activities

- **Run + improve the AI drafting pipeline** (quality, schema-validation,
  classification, safety guardrails).
- **Ship cross-platform** (iOS live, web live, Android next) via EAS + the
  deploy pipeline.
- **Capture-surface coverage** (Share Sheet, more source types) — the Universal
  Collector.
- **Build toward the Loop**: Aspiration Core → Insight Engine → Automation
  Engine.
- **Trust & safety**: content guardrails, data retention/export correctness,
  privacy posture.

---

## 8. Key partners

| Partner | Role | Cost/dependency note |
| --- | --- | --- |
| Google (Gemini) | Core AI drafting + embeddings (server path) | Per-token inference cost; the largest variable cost. |
| Apple | iOS distribution + billing | 15–30% cut on in-app purchases. |
| Google Play | Android distribution + billing | 15–30% cut. |
| RevenueCat | Subscription infra | Platform fee on tracked revenue (free under a revenue threshold; ASSUMPTION ~1% above it). |
| Resend | Transactional email (verification, archive links) | Low per-email cost. |
| Apify | Instagram ingest path | Paid token; only on the Instagram path. |
| Hosting / VPS + Caddy | Postgres, web, worker, media serving | Fixed monthly infra. |
| Expo / EAS | Builds + OTA updates | Per-build / plan cost. |

---

## 9. Cost structure

**Variable (scales with usage)**

- **AI inference (Gemini)** — drafting + embeddings on the server path. **The
  dominant variable cost.** Mitigated by:
  - **On-device drafting** (iPhone): pushes drafting cost to the user's hardware
    → ~$0 marginal inference for those drafts. This is the single biggest
    margin lever and a strategic moat.
  - The free-tier AI-draft cap, which bounds inference spend on non-payers.
- **App-store cut** — 15–30% of in-app subscription revenue (the largest
  revenue-side leakage; web checkout reduces it where permitted).
- **RevenueCat fee** — on tracked subscription revenue above the free threshold.
- **Apify** — per-run, Instagram path only.
- **Resend email** — verification + archive-download emails.
- **Storage/egress** — retained originals + archives grow with active users.

**Fixed (roughly flat)**

- Postgres + VPS/infra + Caddy (web, worker, media).
- EAS build/OTA plan.
- Domain, monitoring, baseline SaaS tooling.
- Team time (the real fixed cost early on).

**Cost-structure principle:** Sirius is **margin-advantaged by on-device AI** —
the more drafting happens on the iPhone, the lower the marginal cost of an
active user, and the better gross margin scales. The two structural pressures
are the **app-store cut** (steer to annual + web checkout) and **server-side
Gemini spend** (bound by caps + on-device offload). Concrete per-user numbers
and margin scenarios are in
[`02-financial-assumptions.md`](./02-financial-assumptions.md).

---

## At a glance

| Block | Today | North star |
| --- | --- | --- |
| Value prop | Capture anything → reviewable draft + private corpus | Closes the loop: context → action |
| Segments | Broad prosumer, self-select | + Teams |
| Channels | App Store, web, Share Sheet, catalogs, MCP | + Play, category narrative |
| Revenue | Free + Pro (RevenueCat) | + Team, usage-based automation |
| Moat | Ownership, on-device privacy, the corpus | Compounding Life Context |
| Cost driver | Gemini inference, store cut | Offset by on-device AI |
