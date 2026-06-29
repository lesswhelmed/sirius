# Sirius — Messaging Framework

_The working reference for how Sirius talks: positioning, taglines, pitches, the message house, voice, lexicon, and objection handling. Last updated 2026-06-29._

This is the document writers, marketers, and the founder cite when they need the _right_ words. If copy disagrees with this file, this file wins.

---

## I. Positioning statement

> **For** the broad prosumer drowning in scattered inputs — links, screenshots, notes, voice memos —
> **who** captures far more than they ever turn into anything,
> **Sirius is the life-context engine**
> **that** turns anything you capture into something worth keeping, and uses the accumulated context to organize and surface what matters,
> **unlike** Notion AI, Mem, NotebookLM, Obsidian, or native ChatGPT/Apple memory, which only store and recall —
> **Sirius understands your context and, increasingly, closes the loop, on your terms.**

Let the segments self-select from the universal hook: the overwhelmed professional, the second-brain power user, the creator. Lead broad; never narrow the door.

---

## II. The value pyramid

Read bottom-up: features ladder to feelings.

| Layer | The promise |
| --- | --- |
| **Highest — the feeling** | **Feel lesswhelmed.** A fixed point amid the noise. |
| **Emotional** | Peace of mind. Nothing is lost. You're on top of your inputs instead of buried by them. Your data is yours. |
| **Experiential** | Capture anything in two taps. Get back something clean and structured. Find it later by meaning, not just words. |
| **Functional** | Capture from everywhere → AI drafts → you review → it's kept, organized, searchable, mapped by meaning. |

---

## III. Taglines

**Primary brand line:** **Your life, in context.**
**Emotional payoff:** **Feel lesswhelmed.**

**Approved alternates** (remix freely; keep them concrete):

- Capture now. Sorted later.
- Everything you capture, drafted into something worth keeping.
- AI drafts it. You decide what's worth keeping.
- The brightest point in your night sky of inputs.
- Your scattered inputs, finally in context.

**Do not** invent taglines that claim automation or "closes the loop today." Closing the loop is the north star, not a shipped feature.

---

## IV. Elevator pitches

**10 words**
> Sirius turns anything you capture into private context worth keeping.

**40 words**
> Sirius is a life-context engine. Capture anything — links, photos, notes, videos, voice memos — and AI drafts each one into a clean, structured post you review and keep. Over time, your context compounds, so Sirius can organize and surface what matters. Feel lesswhelmed.

**100 words**
> Most of us capture far more than we ever turn into anything: links we meant to read, screenshots we forgot, notes that died in a thread. Sirius is a life-context engine that fixes this. Capture anything — from the app or the iOS Share Sheet — and AI drafts it into a clean, structured post with a title, summary, and tags, which you review before keeping. On iPhone, that drafting can run entirely on-device. Everything stays private by default and fully exportable. As your captures accumulate, Sirius maps them by meaning and surfaces connections. Your life, in context. Feel lesswhelmed.

---

## V. The message house

Three pillars. Every proof point below **ships today.**

### Pillar 1 — Capture anything, get something worth keeping
> The universal hook. No friction, no blank page.

**Proof points (shipping):**
- Capture links/URLs, photos & screenshots, notes, code repos, YouTube videos, documents, and voice memos.
- In-app **Capture** tab **and** the iOS system Share Sheet — share anything into Sirius with no app-switching.
- AI drafts every capture into a structured post (title, summary, tags, categories, body) with schema-validated output.
- Auto-classified post types: **Finding** (URLs), **Sight** (image batches), **Blog** (notes), plus Instagram and YouTube paths.
- A live **Queue** state machine (pending → processing → completed/failed) so nothing is silently lost.

### Pillar 2 — Context that compounds
> Captures aren't clutter; they're context. The more you add, the more Sirius understands.

**Proof points (shipping):**
- **The Tree / Observatory** maps your whole corpus by meaning — a taxonomy outline plus a 3D embedding "space," with related posts grouped (web `/space`, mobile Tree tab).
- **Curated search** fuses Postgres full-text and embedding similarity (Reciprocal Rank Fusion), visibility-gated, with exact/similar match badges.
- **Catalog** holds your whole library, draft → published, private by default.
- **Friends hub + shared feed** with per-post visibility (Private / Friends / Group / Public) and named friend-groups — a merged feed separate from your private catalog.

### Pillar 3 — Your data, your terms
> Private by default. Yours to keep, export, or expose only when you choose.

**Proof points (shipping):**
- On iPhone, AI **drafting can run entirely on-device** — private, no server round-trip. You always review before anything is kept.
- Every uploaded original is **retained privately** for you; one-tap **full export/archive** delivered as an emailed download.
- **No third-party ads, no cross-app tracking.**
- **MCP corpus server:** expose your own corpus to external AI agents via a per-user API key — your context, usable by the AI tools you choose.

---

## VI. Voice and tone

**Principles:**
- **Calm and editorial.** Write like a good newspaper, not a launch deck.
- **Concrete verbs.** Capture, draft, keep, map, surface, close the loop. Not: leverage, empower, supercharge, seamless.
- **Short sentences.** One idea each. Let white space do work.
- **Quietly confident.** State what's true. Don't oversell. The product gives peace of mind; the copy should feel like it.
- **Honest about the roadmap.** Never present automation / closing-the-loop as shipped.

### Do / Don't

| Do | Don't |
| --- | --- |
| "Capture anything. Sirius drafts it." | "Leverage AI to supercharge your workflow." |
| "Private by default. Yours to export." | "Bank-grade, military-grade security." |
| "You review before anything is kept." | "Fully automated — set it and forget it." (roadmap) |
| "Maps your corpus by meaning." | "Revolutionary, game-changing knowledge graph." |
| "Feel lesswhelmed." | "Get 10x more productive instantly!" |
| Name a real feature | Invent a feature to sound bigger |

### Before / after rewrites

**Before:** "Sirius leverages cutting-edge AI to seamlessly transform your content into a powerful, intelligent second brain that supercharges your productivity."
**After:** "Capture anything. Sirius drafts it into a clean post you review and keep. Over time, it maps everything by meaning, so you can actually find it."

**Before:** "Our revolutionary automation engine closes the loop and takes action for you, hands-free."
**After:** "Today, Sirius captures, drafts, and organizes. Closing the loop — suggested actions that act for you — is where we're headed." _(roadmap, honestly labeled)_

**Before:** "Unlock the full potential of your digital life with the ultimate all-in-one knowledge platform."
**After:** "All your scattered inputs, in one place, drafted into something worth keeping. Your life, in context."

---

## VII. The brand lexicon

Use these terms exactly. Capitalize feature surfaces as proper nouns.

| Term | Definition | How to say it |
| --- | --- | --- |
| **Sirius** | The product and company. The hero brand. | "Sirius drafts it for you." Never "the Sirius app does…" when "Sirius" alone reads fine. |
| **lesswhelmed** | The web/email domain and the emotional promise. Lowercase, never a co-brand. | "Feel lesswhelmed." / "Find us at lesswhelmed.com." |
| **Life Context** | The accumulated, private context Sirius builds from everything you capture — aspirations, projects, inputs. The moat. | "Your Life Context compounds." Capitalized. |
| **the Loop** | The path from scattered inputs → drafts → organization → action. "Closing the Loop" = the automation north star. | "Sirius closes the loop." Lowercase "loop" mid-sentence is fine; "the Loop" as a named concept. |
| **Capture** | The act and the tab. Getting anything into Sirius. | "Capture a link." / "the Capture tab." |
| **Catalog** | Your whole private library of posts, draft → published. | "It's in your Catalog." Private by default. |
| **the Tree / the Observatory** | Your corpus mapped by meaning. **Observatory** = web `/space`; **Tree** = mobile tab. Same idea, two surfaces. | "Open the Observatory." / "the Tree tab." |
| **Friends** | The hub + shared feed with per-post visibility and named groups. | "Share it to a Friends group." |
| **Queue** | The live processing state machine. | "It's in the Queue, processing." |
| **Finding / Sight / Blog** | Auto-classified post types (from URLs / image batches / notes). | Capitalized as type names. |
| **Pro** | The paid subscription tier. | "Upgrade to Pro." |

---

## VIII. Objection handling

| Objection | Response |
| --- | --- |
| **"Another note-taking app?"** | No. Notes apps store; Sirius understands. Every capture is drafted into a structured post and mapped by meaning, and your context compounds so the system gets more useful the more you use it. |
| **"Is my data private / are you training on it?"** | Private by default. No ads, no cross-app tracking. On iPhone, AI drafting can run entirely on-device. Every original is retained for _you_, and you can export everything in one tap. |
| **"Why trust AI to write my stuff?"** | You don't have to. AI only drafts. You review before anything is kept or published. "AI drafts it. You decide what's worth keeping." |
| **"I already use Notion / Obsidian / NotebookLM."** | Those are great at storing and recalling. Sirius adds the context layer they don't have — it maps everything by meaning and is built to close the loop, turning a second brain into a system that acts. |
| **"What does it actually do today vs. someday?"** | Today: capture anything, AI drafts it, you keep it, it's organized, searchable, and mapped by meaning, fully private and exportable. The north star — suggested actions and automations that act for you — is roadmap, and we say so. |
| **"Is it locked to Apple?"** | Native iOS plus a full web app at lesswhelmed.com. An Android build exists. Your corpus is exportable and you can expose it to outside AI tools via the MCP corpus server. |
| **"What does the cat have to do with anything?"** | A cat sees in the dark — it finds the signal in your clutter. The star Sirius is the fixed point you navigate by. Together: clarity amid overwhelm. |

See siblings: [Brand Strategy](./00-brand-strategy.md) · [Visual Identity](./02-visual-identity.md) · [Naming & Nomenclature](./03-naming-nomenclature.md).
