# Sirius — Go-to-Market Plan

_The launch operating plan: objectives, funnel, channels, timeline, and risks. Last updated 2026-06-29._

> Sirius is the life-context engine. We capture anything you throw at it, draft it
> into something worth keeping, and organize it by meaning — so the longer you use
> it, the better it understands your life. **Your life, in context. Feel lesswhelmed.**

This plan covers the first public launch of Sirius (iOS + web at lesswhelmed.com).
Read it alongside [the launch announcement copy](./04-launch-announcement.md).

---

## I. Launch objectives

We are launching a real product with a real wedge, not chasing a vanity spike. The
objectives are ordered; if we have to trade, protect the one above.

1. **Prove the core loop converts.** A new user captures something, gets a draft
   worth keeping, and keeps it. This is the "aha" — everything downstream depends on it.
2. **Seed the context moat.** Drive enough repeat capture that early users accumulate
   real Life Context. Retention, not raw signups, is the win condition.
3. **Plant the category flag.** Be the clearest articulation of "life-context engine /
   close the loop" while the personal-context category is still forming (it's being
   called the defining AI capability of 2026).
4. **Generate durable distribution.** Light the built-in growth loops (public catalog,
   invite/QR share, Friends, MCP) so acquisition compounds past launch week.

### What we are NOT optimizing for
- Not a one-day Product Hunt rank for its own sake.
- Not press volume. One sharp narrative placement beats ten reposts.
- Not paid acquisition at launch. We earn the funnel before we buy it.

---

## II. Metrics: north star + funnel

### North-star metric
**Weekly Kept Captures per Active User (WKC/AU)** — the count of captures a user
reviews and keeps (publishes or saves to catalog) per active week.

It is the single number that fuses our three truths: capture happened (acquisition),
the draft was good enough to keep (activation/quality), and the user came back to do
it again (retention). It is also the leading indicator of the moat — kept captures
_are_ accumulated Life Context.

### Funnel metrics

| Stage | Metric | Launch target (90 days) |
|---|---|---|
| Acquire | New accounts created | 5,000 ASSUMPTION |
| Activate | % who complete ≥1 capture in first session | ≥ 60% |
| Aha | % who **keep** ≥1 draft in first session | ≥ 40% |
| Habit | % who capture on ≥3 distinct days in week 1 | ≥ 25% |
| Retain | Week-4 active retention | ≥ 20% ASSUMPTION |
| Monetize | Free → Pro conversion (cohort, 90d) | 3–5% ASSUMPTION |
| Refer | % of new accounts from an invite/QR/public link | ≥ 15% |

All targets above the platform-data line are ASSUMPTION — we have no launch baseline
yet. Lock real baselines after week 1 and re-cut these.

### Guardrail metrics (don't let the funnel lie)
- **Draft-keep rate** (kept ÷ drafted). If acquisition rises while this falls, the AI
  quality is degrading under load — pause spend, fix the pipeline.
- **Queue failure rate** (`failed` ÷ submissions). The Queue state machine is the
  promise that "nothing is lost." Watch it like an SRE metric.
- **On-device draft share** (iPhone). A privacy proof point and a server-cost lever.

---

## III. The acquisition funnel

```
Awareness        →  Product Hunt · Show HN · X/LinkedIn · press · niche communities
   ↓
Consideration    →  lesswhelmed.com landing · /product page · public /catalog posts · demo video
   ↓
Acquisition      →  App Store install · web sign-up
   ↓
Activation       →  first capture → first KEPT draft (the aha)
   ↓
Retention        →  Share Sheet habit · Queue trust · Tree/Observatory payoff · Friends feed
   ↓
Referral / Loops →  public catalog · invite + QR card · Friends groups · MCP API key
```

The job of every channel is to deposit the right person at Consideration with the
right expectation: **capture anything, get something worth keeping.** We let segments
self-select from there — the overwhelmed professional, the second-brain power user,
the creator.

---

## IV. Channel strategy

### A. Product Hunt (primary launch beat)
- **Why:** the prosumer/maker audience self-selects exactly our second-brain segment.
- **Asset:** product as hero, the cat-in-the-bag icon as the scroll-stopper, a 45–60s
  demo video that shows the Share Sheet → draft → keep loop end to end.
- **Play:** ship the [PH listing copy](./04-launch-announcement.md#product-hunt). Maker
  active in comments all day. Lead with the wedge (context layer that closes the loop),
  not a feature dump. Offer a launch-day Pro trial extension to commenters.
- **Pre-work:** line up a credible hunter; notify the email list + waitlist the night
  before (PH frowns on mass "go upvote" asks — invite people to _try it_, not vote).

### B. Show HN / Hacker News
- **Why:** the on-device-AI + MCP + own-your-data story is genuinely interesting to HN,
  and HN's BS detector rewards the honest "ships today vs north star" framing.
- **Asset:** [Show HN post](./04-launch-announcement.md#show-hn). Technical, specific,
  no marketing gloss. Lead with on-device llama.rn drafting and the per-user MCP server.
- **Play:** post Tue–Thu morning ET. Founder answers every top comment with engineering
  detail. Never argue; concede roadmap gaps openly (automation is north star, not live).

### C. App Store / ASO
- **Why:** the App Store is a standing acquisition channel, not a launch-day event.
- **Levers:** title + subtitle carry "life-context engine" and "capture anything";
  keyword field targets _second brain, note capture, AI notes, save links, read later,
  knowledge base, personal AI_. Screenshots tell the loop story (capture → draft →
  keep → Tree). Promo text + "What's New" from the [announcement doc](./04-launch-announcement.md#app-store).
- **Note:** the Apple "Download on the App Store" badge keeps its rounded corners — the
  one intentional exception to our zero-radius rule. Use the official badge.

### D. Content & SEO (the compounding channel)
- **Pillar narrative:** "context engineering / personal context as the defining AI
  capability of 2026" — own the explainer. Cite the real category sources (Anthropic on
  effective context engineering; mem0 State of AI Agent Memory 2026; The New Stack on
  memory for AI agents).
- **Cornerstone posts:** _What is a life-context engine?_ · _On-device AI drafting,
  explained_ · _Second brains store; Sirius understands_ · _Own your data: export,
  retention, MCP_.
- **Programmatic surface:** public `/catalog/[handle]` pages are indexable, real-content
  SEO that grows with the user base — every public post is a landing page.
- **Comparison pages:** honest "Sirius vs Notion AI / Mem / NotebookLM / Readwise"
  pages that win on the context-layer + ownership + on-device angle.

### E. X / LinkedIn (founder-led)
- **X:** the [launch thread](./04-launch-announcement.md#x-thread) on launch day, then a
  steady "build in public" cadence — capture demos, Tree/Observatory screenshots, the
  on-device privacy angle. Voice: calm, concrete, editorial. Never hypey.
- **LinkedIn:** the [LinkedIn post](./04-launch-announcement.md#linkedin) aimed at the
  overwhelmed-professional segment — overwhelm → clarity, "Feel lesswhelmed."

### F. Niche communities (earn, don't spam)
- r/Notion, r/ObsidianMD, r/PKMS, r/productivity; PKM Discords; second-brain newsletters
  (cross-promo, not ads). Show up as a participant first. Lead with the on-device +
  ownership story, which these communities actually care about.
- Indie/maker communities (Indie Hackers, WIP) for the build-in-public arc.

### G. Built-in growth loops (the durable engine)
| Loop | Mechanism | How we light it |
|---|---|---|
| **Public catalog** | `/catalog/[handle]` shares are public, indexable pages | Prompt users to publish; every share is an ad + SEO page |
| **Invite + QR** | rich OG invite card + QR + public `/u/<handle>` landing | One-tap share from web modal + mobile sheet |
| **Friends + groups** | per-post FRIENDS/GROUP feed pulls invitees in | Onboarding nudge to add ≥1 friend; shared feed needs peers |
| **MCP / API** | per-user MCP server (mcp.lesswhelmed.com) | Power users wire Sirius into their own AI tools → lock-in |

Referral isn't a bolt-on coupon; it's these four product surfaces. Instrument each with
its own attribution so we know which loop actually compounds.

---

## V. Timeline

### Pre-launch (weeks −6 to −1)
| Week | Focus |
|---|---|
| −6 | Lock positioning + this GTM plan. Finalize App Store metadata + screenshots. Stand up lesswhelmed.com landing + `/product` page. |
| −5 | Record the 45–60s demo video (Share Sheet → draft → keep → Tree). Draft all [announcement copy](./04-launch-announcement.md). |
| −4 | Open a waitlist. Seed 25–50 real users (dogfood). Confirm Queue + on-device drafting are solid under load. |
| −3 | Line up PH hunter. Soft-publish 2 cornerstone SEO posts. Brief any friendly press/newsletters under embargo. |
| −2 | TestFlight → App Store submission (use the `ios-app-store-deploy` runbook). Build the invite/QR assets. Rehearse launch-day ops. |
| −1 | Warm the list. Pre-write X thread + Show HN. Final QA: sign-up, capture, draft, keep, export, MCP key mint. Freeze the build. |

> **The founder social drip for these weeks** — the day-by-day build-in-public posts that fill the waitlist — lives in [`05-prelaunch-social.md`](./05-prelaunch-social.md), with a posting calendar mapped to the weeks above.

### Launch week (day-by-day)
| Day | Move |
|---|---|
| **Mon** | Soft "we're live" to waitlist + email list. Publish landing updates. Watch activation funnel; fix anything sharp before the big beats. |
| **Tue** | **Product Hunt launch** at 12:01 AM PT. Maker in comments all day. Post the [X thread](./04-launch-announcement.md#x-thread). |
| **Wed** | **Show HN** Tue–Thu morning ET (sequence to not collide with PH attention). Founder answers every comment. |
| **Thu** | LinkedIn post (professional segment). Begin niche-community participation. Share PH/HN results transparently on X. |
| **Fri** | Recap + thank-you to early users. Publish a "launch week, in numbers" build-in-public post. Triage the week's bug + feedback queue. |

### Post-launch (30 / 60 / 90)
- **30 days:** Lock real funnel baselines; re-cut targets. Ship the top 3 activation
  fixes surfaced at launch. Publish 2 more cornerstone SEO posts. First comparison page.
- **60 days:** Optimize Free→Pro (paywall placement, the AI-draft cap experience). A/B
  the first-run/onboarding path to the aha. Stand up the public-catalog SEO flywheel
  (sitemaps, structured data). Begin creator/PKM partner outreach.
- **90 days:** Evaluate paid acquisition _only if_ the organic funnel + retention are
  healthy. Ship the first **north-star** teaser (Aspiration Core / Insight Engine) to
  the build-in-public audience as the "what's next" narrative. Review the moat: is
  WKC/AU trending up per cohort over tenure?

---

## VI. Free vs Pro in acquisition

| Tier | Role in the funnel |
|---|---|
| **Free** | The top of funnel and the loop fuel. Real value, real capture, real Tree — capped at ~10 AI drafts/week (ASSUMPTION for modeling). Generous enough to reach the aha and build a habit; the cap bites exactly when the user is already hooked. |
| **Pro** | RevenueCat-backed subscription. Removes the draft cap, unlocks the heaviest capture/drafting. Positioned as "you've made Sirius part of your life — now take the cap off," not as a gate on the core experience. |

Conversion principle: **let the context moat sell Pro.** The longer someone uses Sirius,
the more their Life Context is worth to them, and the more the cap pinches. We do not
paywall the aha; we paywall scale.

---

## VII. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI draft quality disappoints at the aha | Med | High | Guardrail on draft-keep rate; "you always review before keeping" framing sets honest expectations; schema-validated Gemini output |
| Launch spike overruns the worker queue | Med | High | Watch queue failure rate as an SRE metric; on-device drafting offloads iPhone load; concurrency capped + lease-reclaim already in worker |
| "Just another note app" perception | High | High | Lead every channel with the context-layer + close-the-loop wedge, never feature lists; comparison pages; the Tree/Observatory as visual proof |
| Roadmap-as-shipped credibility hit (esp. on HN) | Med | High | Honesty rule, hard: automation/insight engine is **north star**, labeled as such everywhere. Never claim closing-the-loop is live |
| Privacy skepticism | Med | Med | On-device drafting, retained originals, one-tap export, no ads / no cross-app tracking — make ownership a headline, not fine print |
| Spike with no retention | Med | High | Optimize for WKC/AU and the loops, not signup count; instrument week-1 habit early and react |
| App Store review delay/rejection | Low | High | Submit by week −2; follow the `ios-app-store-deploy` runbook; verify prod points at lesswhelmed.com before shipping |
| Single-founder bandwidth on launch day | High | Med | Pre-write all copy; stagger PH (Tue) and HN (Wed) so attention isn't simultaneous; queue triage to Friday |

---

## VIII. Definition of a successful launch

Not the Product Hunt rank. Success is: a cohort that **keeps coming back to capture**,
a draft-keep rate that holds under load, at least one growth loop visibly compounding,
and a clear "life-context engine" narrative that the market starts repeating back to us.
Everything else is a vanity metric.
