# Sirius — FAQ

_Honest answers for users and press. Last updated 2026-06-29._

> **Sirius — Your life, in context.** Capture anything; AI drafts it into something
> worth keeping; you decide. **Feel lesswhelmed.**

---

## The basics

### What is Sirius?
Sirius is a **life-context engine**. You capture the scattered stuff of your life —
links, photos, screenshots, notes, code repos, videos, documents, voice memos — and
Sirius turns each piece into a clean, structured post (title, summary, tags,
categories, body). Over time those posts become private *context about your life*
that Sirius organizes, maps by meaning, and searches. It runs as a native iOS app
and a web app at **lesswhelmed.com**.

### Where does the name come from?
Sirius is the brightest star in the night sky — a fixed point sailors steered by. We
mean it as clarity amid overwhelm. The app icon is a black cat with sage-gold eyes:
a cat sees in the dark and finds the signal in your clutter.

### What can I capture?
Links/URLs, photos and screenshots, plain notes, code repositories, YouTube videos,
documents, and voice memos — through the in-app **Capture** tab or the iOS system
**Share Sheet** ("share anything into Sirius, no app-switching").

### What happens to a capture?
It's drafted by AI into a structured post and auto-classified by type — **FINDING**
(from URLs), **SIGHT** (from image batches), **BLOG** (from notes), plus dedicated
Instagram and YouTube paths. You then **review** the draft and decide what to keep.
Nothing is published silently.

---

## How is it different?

### …from a notes app (Apple Notes, Obsidian)?
Notes are passive — you write, file, and later go hunting. Sirius **drafts the post
for you** and files it by meaning automatically, then maps your whole corpus in a
taxonomy and a 3D "space". You spend less time organizing and more time thinking.

### …from Notion AI?
Notion AI helps you write inside documents you structure by hand. Sirius is built
around **capture → understand**: it ingests anything from anywhere, classifies it,
and builds a context graph of your aspirations, projects, and inputs. Different job,
different shape.

### …from ChatGPT / chatbot "memory"?
Chatbot memory is a flat list of facts the model recalls mid-conversation, owned by
the vendor. Sirius's Life Context is a **structured graph you own and can export**,
that exists independent of any one model — and you can point your *own* AI tools at
it via the MCP server.

### …from a bookmark / read-later app (Readwise, Pocket)?
Those capture URLs to read later. Sirius captures **anything**, drafts it into
something worth keeping, and connects it to the rest of your context.

---

## Privacy, data, and ownership

### Is my data private?
Yes. Your catalog is **private by default**. You choose per post whether something
stays PRIVATE, goes to FRIENDS, a named GROUP, or PUBLIC.

### Do you sell my data or run ads?
**No third-party ads, no cross-app tracking, no selling your data.** Period.

### What runs on-device?
On iPhone, the AI **drafting** can run **entirely on-device** with a local model
(llama.rn) — your capture never leaves the phone for that step. It's a toggle in the
composer when on-device AI is enabled.

### Does it work offline?
The mobile app keeps a local mirror so you can browse your catalog offline. Some
features need a connection: server-side AI drafting, curated search, and syncing new
captures. On-device drafting on iPhone works without a server round-trip.

### Can I export my data or leave?
Yes. Every uploaded **original is retained privately** and kept until you delete the
post. From Settings, one tap requests a **full archive** — we zip your originals plus
note text and email you a download link. No lock-in.

---

## Social features

### What are Friends?
A **Friends hub** with a shared feed that's separate from your private catalog. You
set per-post visibility (PRIVATE / FRIENDS / GROUP / PUBLIC), and friends' shared
posts merge into one feed alongside your own shared posts. Your **PRIVATE** posts
never appear there.

### What's the public catalog?
An optional public profile at **/catalog/[handle]** for posts you choose to make
PUBLIC. It's off unless you opt in.

---

## Platforms, pricing, and the API

### What platforms are supported?
Native **iOS** app and a **web** app (lesswhelmed.com). An **Android** build exists
in EAS.

### What does it cost?
There's a **free tier** (capture, catalog, search, the Tree) with an AI-draft cap —
**ASSUMPTION: ~10 AI drafts/week** — and a **Pro** subscription (RevenueCat-backed)
that lifts the cap and unlocks the full toolkit. _Exact Pro pricing: TBD._

### What is the MCP / API?
The **MCP corpus server** lets you expose *your own* corpus to external AI agents
via a per-user API key at **mcp.lesswhelmed.com** — your context, usable by the AI
tools you choose, under your control.

---

## The roadmap (honest)

### What's coming that isn't shipped yet?
Today Sirius captures, drafts, organizes, maps, and searches. The **north star** is
to build richer Life Context and then **close the loop**:

1. **Aspiration Core** — capture your goals, projects, and focus areas so the system
   knows *why* a captured thing matters.
2. **Insight Engine** — an Opportunity Dashboard and "Connect-the-Dots" surfacing
   across your entire private corpus.
3. **Automation Engine** — one-click suggested actions and "Automations" that act on
   your behalf.

> To be clear: the Insight and Automation phases are **not shipped yet**. We won't
> claim them as live until they are. What ships today is capture → AI draft →
> organize → map → search, with privacy and export built in.

### Why will it get better the longer I use it?
Because Life Context **compounds**. Every capture sharpens what Sirius knows about
your aspirations and projects — which makes every future draft, connection, and
(soon) action better. Competitors store; Sirius understands and acts.

---

_See also: [Product vision](00-product-vision.md) · [One-pager](01-one-pager.md) · [Launch copy](03-launch-copy.md)_
