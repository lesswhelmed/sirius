# Competitive Landscape

_GTM cluster · Market & Competitive · last updated 2026-06-29_

> Everyone in this market sells **capture + recall**. None of them own
> **life-context → action**. That gap is Sirius's wedge.

This document maps the field against the dimensions that decide the category,
gives an honest read on each competitor, and states Sirius's differentiation,
candidate moats, and the risks we are not pretending away.

See also: [Market Research](00-market-research.md) · [Positioning & ICP](02-positioning-and-icp.md).

---

## I. The comparison matrix

Legend: ●●● strong · ●● partial · ● weak/none · — not applicable.
Ratings are an editorial read of each product's *current shipped* capability as of
2026-06-29, not a benchmark.

| Product | Capture breadth | AI structuring | Recall / search | Life-context / goals | Closes the loop (action) | Privacy & on-device | Ownership / export | Public catalog |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Notion AI** | ●● | ●● | ●● | ● | ● | ● | ●● | ●● |
| **Mem** | ●● | ●● | ●● | ● | ● | ● | ●● | ● |
| **Google NotebookLM** | ●● | ●●● | ●●● | ● | ● | ● | ● | ● |
| **Obsidian** | ●● | ● | ●● | ● | ● | ●●● | ●●● | ●● |
| **Rewind / Limitless** | ●●● | ●● | ●●● | ● | ● | ●● | ●● | ● |
| **Readwise Reader** | ●● | ●● | ●● | ● | ● | ● | ●● | ● |
| **Native ChatGPT / Apple / Google memory** | ●● | ●● | ●● | ●● | ● | ●● | ● | — |
| **Sirius** | ●●● | ●●● | ●●● | ●● → ●●● (roadmap) | ● → ●●● (roadmap) | ●●● | ●●● | ●●● |

**How to read the two arrows on Sirius.** Life-context and close-the-loop show
both *today* and *roadmap* because honesty is the rule. Today Sirius captures the
seed of life-context (your posts, organized by meaning in the Tree) and does not
yet take autonomous action. The arrows are the north star — clearly *not shipped*.

---

## II. Per-competitor takes

### Notion AI
The default workspace for many teams; AI is layered onto docs/databases. **Strength:**
ubiquity and a structured workspace people already live in. **Gap for us:** capture
is manual and doc-shaped, there's no goal/aspiration model, and nothing closes a
loop — it's a place you organize, not a system that understands and acts.

### Mem
An AI-native notes app built around self-organizing notes and recall. **Strength:**
early, opinionated take on AI memory for notes. **Gap for us:** still fundamentally
store-and-recall; no life-context spine, no on-device privacy story, no action layer.

### Google NotebookLM
Best-in-class at *grounded synthesis* over a set of sources you hand it.
**Strength:** structuring and Q&A over a corpus is genuinely strong. **Gap for us:**
it's session/notebook-scoped, not a persistent life-context layer; capture is
manual; cloud-only; no ownership/export story or action loop.

### Obsidian
The power-user's local-first knowledge base. **Strength:** ownership and privacy
are excellent — plain files on your disk; huge plugin ecosystem. **Gap for us:**
AI structuring is bring-your-own and bolt-on; capture is manual; no life-context
model; no action. Obsidian is the honest benchmark for *ownership*, which is
exactly why Sirius matches it on ownership **and** adds AI drafting + context.

### Rewind / Limitless
Always-on capture (screen, audio) with strong recall. **Strength:** capture breadth
and "what did I see/hear" recall. **Gap for us:** capture is passive-surveillance
shaped (a privacy lightning rod), structuring is thin, and there's no goal model or
action layer — it's a searchable past, not a system that acts on your future.

### Readwise Reader
Best-in-class read-it-later + highlights, with spaced resurfacing. **Strength:**
the reading/highlight workflow and resurfacing. **Gap for us:** scoped to reading;
no broad capture, no life-context, no action; cloud-only.

### Native ChatGPT / Apple / Google memory
Memory bolted onto assistants and OSes with massive reach. **Strength:** distribution
and the fact that they normalized "software remembers you." **Gap for us:** the memory
is *theirs* — locked in their product, not portable, not owned, not exposable to the
tools you choose. This is the incumbency risk and the wedge in the same breath.

---

## III. Sirius's differentiation

Sirius is the only entrant whose **purpose** is the context layer between a second
brain and an ambient agent. Concretely, what ships today and stacks into that:

- **Capture anything, frictionless.** Links, photos & screenshots, notes, code
  repos, YouTube videos, documents, voice memos — via the Capture tab **and** the
  iOS Share Sheet (share anything in, no app-switching).
- **AI drafting you review.** Each capture becomes a clean, structured post
  (title, summary, tags, categories, body), schema-validated. On iPhone it can run
  **entirely on-device** (local llama.rn model) — private, no server round-trip.
  You always decide what's worth keeping.
- **Organized by meaning.** The Tree / Observatory maps your corpus by embedding
  similarity — a taxonomy outline plus a 3D space, related posts grouped.
- **Yours, on your terms.** Every original is retained privately; one-tap full
  export/archive (emailed link); no ads, no cross-app tracking.
- **Usable by the AI you choose.** A per-user **MCP corpus server** exposes your
  context to external AI agents via your own API key — your context, your tools.
- **Sharing without surveillance.** Per-post visibility (PRIVATE / FRIENDS / GROUP
  / PUBLIC), named friend-groups, a merged shared feed, and an optional public
  catalog at `/catalog/[handle]`.

No competitor combines **broad capture + AI structuring + ownership + on-device
privacy + an MCP-exposable context layer.** That combination is the differentiation.

---

## IV. Candidate moats

| Moat | Why it's durable |
| --- | --- |
| **Compounding Life Context** | The longer you use Sirius, the more it knows your goals — and the better it closes the loop. Switching cost grows with use; a fresh competitor starts at zero context. |
| **Ownership + on-device** | Hard for ad-funded incumbents to copy without breaking their business model. "Private by architecture" is a posture, not a toggle. |
| **MCP / open context** | Being the context layer *for the agents you already use* turns potential competitors (assistants) into distribution. |
| **The loop, shipped incrementally** | Each rung (capture → draft → organize → insight → action) is independently useful, so the moat deepens without a big-bang dependency. |

---

## V. Honest risks

- **Incumbents add memory.** ChatGPT/Apple/Google can ship memory to enormous
  installed bases. Our answer is *portable, owned, on-device, MCP-exposable* — not
  a better memory inside someone else's silo.
- **Platform players.** Apple or Google could ship an OS-level context layer.
  Sirius stays cross-platform and exportable so you're never locked to one OS.
- **Cost of AI.** Per-capture model calls cost money. On-device drafting removes
  server cost on the common path; the free-tier draft cap and Pro tier align price
  to value.
- **Roadmap dependence.** The full moat (Insight + Automation engines) is north
  star, not shipped. We win the present on capture + drafting + ownership, and
  earn the future one rung at a time.

→ Continue: [Positioning & ICP](02-positioning-and-icp.md)
