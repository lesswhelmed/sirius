# Market Research — The Life-Context Engine

_GTM cluster · Market & Competitive · last updated 2026-06-29_

> Sirius is the life-context engine: the private layer that turns everything you
> capture into context about your life, then uses that context to close the loop —
> from scattered inputs to drafts, organization, and (increasingly) action.

This document defines the category Sirius competes in, sizes the opportunity with
cited third-party estimates, names the trends pulling the category into existence
now, and states plainly where Sirius fits.

---

## I. Category definition

### The gap between two known categories

Two product categories already have names and budgets:

| Category | What it does | Examples |
| --- | --- | --- |
| **PKM / "second brain"** | Stores and recalls what you save. Notes, highlights, clips. | Notion, Obsidian, Readwise, Mem |
| **Ambient agents** | Acts on signals without being asked. Proactive, context-aware. | Roadmap-stage across the industry |

A second brain **stores**. An ambient agent **acts**. Neither owns the layer in
between: a private, structured understanding of *your life* — your aspirations,
projects, and inputs — rich enough that software can act on your behalf and be
right.

That layer is **Life Context**. Sirius is the engine that builds it.

```
   CAPTURE  ──►  LIFE CONTEXT  ──►  CLOSE THE LOOP
 (anything)      (the layer)        (drafts → org → action)
   second brain    SIRIUS            ambient agents
   stores          understands       acts
```

### Why "context layer," not "another notes app"

A notes app is judged by how well it holds what you put in. A context engine is
judged by what it can do *because* it understands what you put in. The difference
is the moat: context **compounds**. The longer you use Sirius, the more it knows
your goals, and the better every downstream act — a draft, a connection, a
suggested action — gets.

Competitors store. Sirius understands, and increasingly acts.

### Why the category is forming now

Three forces converged in 2025–2026:

1. **Context engineering became the named discipline.** The industry's framing of
   AI quality shifted from prompt-craft to *context-craft* — what the model knows
   about you at the moment it answers. Anthropic's writing on effective context
   engineering and mem0's *State of AI Agent Memory 2026* both frame personal
   context / memory as the decisive capability, not a feature.
2. **Memory went from novelty to baseline.** ChatGPT, Apple, and Google all
   shipped some form of cross-session memory. That normalized the *expectation*
   that software remembers you — and exposed that none of them give you a private,
   portable, owned context layer you control.
3. **On-device AI got good enough to matter.** Local models on a modern iPhone can
   now draft and structure content with no server round-trip. Privacy stopped
   being a trade-off against capability.

The category is forming because the inputs (capture is easy, models are cheap,
memory is expected) finally make "a system that understands your life" buildable —
and because the privacy backlash makes "and you own it" a wedge, not a footnote.

---

## II. Market sizing

All figures below are **third-party estimates**, cited. Treat them as directional
market context, not Sirius forecasts.

| Market | 2026 | Out-year | CAGR | Source |
| --- | --- | --- | --- | --- |
| **Personal Knowledge Base AI** | ~USD **2.16B** | ~USD **6.15B** (2030) | ~**30%** | Research & Markets; The Business Research Company |
| **Knowledge-management software (broad)** | ~USD **26.4B** | ~USD **74.2B** (2034) | ~**13.8%** | Fortune Business Insights |

**Reading the two numbers.** The tightly-scoped *Personal Knowledge Base AI*
market (~$2.16B, ~30% CAGR) is Sirius's beachhead — the prosumers buying AI second
brains today. The broad *knowledge-management* market (~$26.4B) is the gravity
well the category sits inside: as life-context proves it can drive action, the
addressable surface expands from "smart notes" toward "the system that runs on
your context."

**A note on TAM honesty.** Sirius does not need either market to be bigger than
cited. The bet is on *share of a forming category*, not on inflating the size of an
existing one. Life Context is a wedge into the $2.16B PKB-AI market with a path
toward the larger KM and (eventually) ambient-agent budgets.

---

## III. Trends — tailwinds and headwinds

### Tailwinds (the wind at our back)

| Trend | What's happening | Why it helps Sirius |
| --- | --- | --- |
| **Context engineering** | Industry reframes AI quality as a function of what the model knows about you (Anthropic; mem0; The New Stack, *Memory for AI Agents*). | Sirius *is* the personal context layer. The category's thesis is our product thesis. |
| **Ambient agents** | Shift from systems that respond → remember → act on signals (DigitalOcean ambient-agents tutorial; Moveworks, *What is an ambient agent*). | "Close the loop" is our north star. The market is being taught to want exactly the arc we're building. |
| **Memory as baseline** | ChatGPT/Apple/Google ship memory; users now expect software to remember them. | Raises the floor for everyone and validates demand — while leaving "private + owned + portable" open. |
| **On-device AI** | Phones can draft/structure locally. | Sirius already drafts entirely on-device on iPhone — privacy without a capability tax. |
| **Privacy / ownership backlash** | Distrust of ad-funded, cross-app-tracking data models is rising. | "Your data, your terms" — retained originals, one-tap export, no ads, no cross-app tracking — is a structural differentiator, not a marketing line. |

### Headwinds (the honest risks)

| Risk | Why it's real | How Sirius answers |
| --- | --- | --- |
| **Incumbents add memory** | ChatGPT/Apple/Google can bolt memory onto huge installed bases. | Their memory is locked in *their* product. Sirius's context is yours, portable, on-device, and exposable to the AI tools *you* choose (MCP). |
| **Platform players (Apple/Google)** | Could ship an OS-level personal context layer. | Sirius is cross-platform, owned, and exportable; not betting on one OS being your whole life. |
| **Cost of AI** | Per-capture model calls have real unit cost. | On-device drafting removes server cost for the most common path; a free-tier draft cap and a Pro tier align cost to value. |
| **"Yet another capture app" fatigue** | The space is crowded; users are tired of tools that only store. | Sirius's wedge is precisely *not* storage — it's context → action. The honesty rule: we only claim what ships. |
| **Roadmap dependence** | The full moat (Insight + Automation engines) is north star, not shipped. | Capture + AI drafting + the Tree + Friends + search + ownership ship today and are independently valuable. The loop closes incrementally. |

---

## IV. Where Sirius fits

Sirius is the **context layer between the second brain and the ambient agent**. It
is the one product whose entire reason to exist is to understand your life well
enough to close the loop — and to do it on your terms (owned, exportable,
on-device-capable, exposable via MCP to the agents you choose).

- **Today it ships** the front of the loop: capture anything → AI drafts it →
  you keep what's worth keeping → it's organized by meaning (the Tree), searchable,
  shareable, and yours to export. See [competitive landscape](01-competitive-landscape.md).
- **The north star** is the back of the loop: an Insight Engine that scans your
  whole private corpus, and an Automation Engine that turns context into suggested
  and automatic actions. Clearly *not yet shipped*.

The market is teaching users to expect software that remembers and acts. Sirius is
positioned to be the version of that they actually own.

→ Continue: [Competitive Landscape](01-competitive-landscape.md) ·
[Positioning & ICP](02-positioning-and-icp.md)
