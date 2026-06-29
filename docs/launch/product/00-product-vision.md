# Sirius — Product Vision: The Life-Context Engine

_The Life Context thesis, the "close the loop" arc, and the compounding moat. Last updated 2026-06-29._

> **Brand line:** Your life, in context. **Promise:** Feel lesswhelmed.

Sirius is the brightest star in the night sky — a fixed point sailors steered by.
That is the whole idea here: a fixed point of clarity in the middle of overwhelm.
You capture the scattered stuff of your life — links, photos, notes, repos, videos,
voice memos — and Sirius turns each piece into private **context about your life**,
then uses that context to do useful work on your terms.

---

## 1. The thesis: Sirius is the life-context engine

Most tools in this space store things. Sirius **understands** them, in relation to
*you*. The central object is not a note or a file. It is **Life Context**: a
private, compounding graph of three things.

| Layer | What it holds | Where it lives today |
|---|---|---|
| **Aspirations** | Why a captured thing matters — your goals and focus areas | North star (Aspiration Core, see §3) |
| **Projects** | The active threads you're working — your focus areas | Partial: Tree/Observatory groups by meaning |
| **Inputs** | Everything you capture, drafted into structured posts | **Ships today** (Capture → AI draft → Catalog) |

Life Context is the difference between a drawer of receipts and an accountant who
knows your year. The receipts are inputs. The accountant is the engine that holds
your aspirations and projects and reads every new input *against* them.

### How this differs from "notes" and "memory"

- **Notes** are passive. You write them, you file them, you go find them later.
  Sirius drafts the note *for* you and files it by meaning automatically.
- **Chatbot "memory"** is a flat list of facts a model recalls mid-conversation,
  owned by the model vendor. Life Context is a **structured graph you own**,
  portable and exportable, that exists whether or not a model is in the loop.
- **Bookmark/read-later apps** capture URLs. Sirius captures *anything* and turns
  it into something worth keeping — title, summary, tags, categories, body.

The short version: competitors store; Sirius **understands and (increasingly) acts**.

---

## 2. Why it matters now

"Context engineering" — giving AI the right private context at the right time — is
being called the defining capability of 2026. The industry arc is
**responding → remembering → ambient assistance** (see Anthropic on effective
context engineering; mem0's State of AI Agent Memory 2026; The New Stack on memory
for AI agents). The personal-knowledge-AI market is roughly **USD 2.16B in 2026
growing to ~USD 6.15B by 2030 (~30% CAGR)**, inside a knowledge-management software
market near **USD 26.4B (2026)**.

Everyone is racing to build the **memory layer**. Sirius's wedge is that memory
alone is table stakes — the value is the **context layer that turns a second brain
into a system that closes the loop**, with ownership and on-device privacy baked in.

---

## 3. The arc: build Life Context, then close the loop

The roadmap is one motion in four moves: first build rich Life Context, then use it
to act. Phases 1–2 feed the graph; phases 3–4 spend it.

1. **Aspiration Core** _(north star)_ — capture aspirations, projects, and focus
   areas so the system knows **why** a captured thing matters. This is the seed of
   Life Context.
2. **Universal Collector** _(largely ships today)_ — frictionless capture from
   everywhere: the Capture tab and the iOS Share Sheet. Links, images, notes, code,
   video, documents, voice.
3. **Insight Engine** _(north star)_ — an Opportunity Dashboard, "Connect-the-Dots"
   relationship surfacing, and research that scans your **entire** private corpus.
4. **Automation Engine — "Closing the Loop"** _(north star)_ — one-click suggested
   actions and if-this-then-that **Automations** that act on your behalf.

> **Honesty rule:** Today Sirius captures, drafts, organizes, maps, and searches.
> The Insight and Automation phases (3–4) are **not shipped**. We will say so plainly
> until they are.

---

## 4. Ships today vs north star

| Capability | Status | Notes |
|---|---|---|
| Capture anything (links, photos, notes, code, YouTube, docs, voice) | **Ships today** | Capture tab + iOS Share Sheet |
| AI drafting into structured posts (title, summary, tags, body) | **Ships today** | Schema-validated Gemini pipeline |
| On-device drafting on iPhone | **Ships today** | Local llama.rn model, no server round-trip |
| Auto post types: FINDING / SIGHT / BLOG (+ Instagram, YouTube) | **Ships today** | Type forced by the worker |
| Catalog (draft → published, private by default) | **Ships today** | Optional public `/catalog/[handle]` |
| Queue state machine (pending → processing → done/failed) | **Ships today** | Nothing is lost |
| The Tree / Observatory (taxonomy + 3D embedding space) | **Ships today** | Web `/space`, mobile Tree tab |
| Friends hub + shared feed (PRIVATE/FRIENDS/GROUP/PUBLIC) | **Ships today** | Named friend-groups; merged feed |
| Curated search (full-text + embedding, RRF-fused) | **Ships today** | Visibility-gated |
| Retained originals + one-tap full export/archive | **Ships today** | Emailed download link |
| MCP corpus server (per-user API key) | **Ships today** | `mcp.lesswhelmed.com` |
| Pro subscription + free tier (AI-draft cap) | **Ships today** | RevenueCat; ~10 drafts/wk free _(ASSUMPTION)_ |
| Aspiration Core (goals/projects as first-class context) | **North star** | Phase 1 |
| Opportunity Dashboard + Connect-the-Dots insights | **North star** | Phase 3 |
| One-click actions + Automations (closing the loop) | **North star** | Phase 4 |

---

## 5. Product principles

1. **Review before keep.** AI drafts; *you* decide what's worth keeping. Nothing is
   published silently. The model is a fast intern, not the editor-in-chief.
2. **Your data, your terms.** Every uploaded original is retained privately. One tap
   exports everything. No third-party ads. No cross-app tracking.
3. **Privacy is a feature, not a setting.** On iPhone, drafting can run **entirely
   on-device** — your capture never leaves the phone. Private by default, public by
   choice.
4. **Ownership over lock-in.** Your corpus is yours to take. The MCP server lets the
   AI tools *you* choose read *your* context — the moat is trust, not a cage.
5. **Calm by design.** Flat, ruled, editorial. Capture now, sorted later. The
   product should feel the way the promise reads: lesswhelmed.

---

## 6. The compounding moat

Most products are as useful on day 365 as on day 1. Life Context is the opposite:
it **compounds**. Every capture sharpens what Sirius knows about your aspirations
and projects, which makes the next draft, the next connection, and (soon) the next
suggested action better. A competitor can copy a feature in a sprint. They cannot
copy two years of *your* context.

That is the defensibility: **the longer you use Sirius, the more it knows your goals
and the better it closes the loop.** Storage is a commodity. Understanding that
acts is the moat.

---

_See also: [One-pager](01-one-pager.md) · [FAQ](02-faq.md) · [Launch copy](03-launch-copy.md)_
