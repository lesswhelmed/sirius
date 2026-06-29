# Sirius — Launch Announcement Copy

_Ready-to-ship launch copy across every channel, in brand voice. Last updated 2026-06-29._

> **Brand line:** Your life, in context. **Promise:** Feel lesswhelmed.
> **Thesis:** Sirius is the life-context engine — capture anything, get something worth
> keeping, and the longer you use it, the better it understands your life.

Honesty rule for everything below: **capture, AI drafting, the Tree, Friends, search,
export, and on-device drafting ship today. Closing the loop (automations, insight
engine) is the north star — never written as live.** See [the GTM plan](./03-go-to-market-plan.md).

---

## Product Hunt

**Name:** Sirius

**Tagline:** Your life, in context — capture anything, drafted into something worth keeping.

**Topics:** Productivity · Artificial Intelligence · iOS · Note-taking

**Description:**
> Sirius is a life-context engine. Capture anything — a link, a screenshot, a voice
> memo, a half-formed note, a repo, a video — and Sirius drafts it into a clean,
> structured post you can actually keep. On iPhone, the drafting can run entirely
> on-device, so it never leaves your phone.
>
> Your captures don't just pile up. They become private context about your life, mapped
> by meaning in a 3D "Tree" of your corpus, searchable across full-text and embeddings,
> and shareable with friends — or kept entirely private. You own every original, and
> you can export everything in one tap.
>
> Most apps store what you save. Sirius understands it. The longer you use it, the more
> it knows what matters to you. **Feel lesswhelmed.**

**Maker's first comment:**
> Hi Product Hunt 👋
>
> I built Sirius because my "save it for later" pile had become its own source of
> overwhelm. Bookmarks, screenshots, voice memos, links I swore I'd read — all of it
> captured, none of it _kept_. The saving was easy. The making-sense-of-it never happened.
>
> So Sirius does the second half. You capture anything — in the app or straight from the
> iOS Share Sheet, no app-switching — and it drafts a clean, titled, tagged post out of
> it. You review, you decide what's worth keeping. On iPhone the drafting can run fully
> on-device, so private things stay private. Every original you upload is retained, and
> you can export the whole archive whenever you want.
>
> What I'm most proud of is the **Tree** — your whole library mapped by meaning, so you
> can finally see the shape of what you've been collecting. That's the seed of the bigger
> idea: a life-context engine that understands _why_ a thing matters to you and,
> increasingly, helps you act on it.
>
> To be straight: capture, AI drafting, the Tree, Friends, search, and export are live
> today. The "close the loop" automation work is the roadmap, not a claim. I'd love your
> honest first-capture reaction — what did you throw at it, and was the draft worth keeping?
>
> — building Sirius, at lesswhelmed.com

---

## Show HN

**Title:**
> Show HN: Sirius – a life-context engine that drafts your captures (on-device on iPhone)

**Body:**
> Sirius turns anything you capture — URLs, screenshots, notes, repos, YouTube videos,
> voice memos — into a clean, structured post, then organizes your whole corpus by
> meaning. It's a native iOS app plus a web app at lesswhelmed.com.
>
> The parts I think HN will find interesting:
>
> - **On-device drafting.** On iPhone, the drafting can run entirely on a local
>   llama.rn model — no server round-trip, no data leaving the device. Server drafting
>   (Gemini, schema-validated output) is the fallback/heavier path. You always review
>   before anything is kept.
> - **A producer/consumer pipeline, not a chat box.** Web/app submit to a Postgres-backed
>   queue; a separate worker daemon claims jobs (optimistic-locked), runs the model, and
>   writes posts directly. A live state machine (pending → processing → completed/failed)
>   means nothing silently disappears.
> - **Your corpus mapped by embeddings.** A 3D "Tree"/Observatory built from a taxonomy
>   outline + embedding space, plus curated search that fuses Postgres full-text and
>   embedding similarity with reciprocal rank fusion, visibility-gated.
> - **Own your data, literally.** Every uploaded original is retained privately;
>   one-tap full export emailed to you. No ads, no cross-app tracking.
> - **A per-user MCP server.** You can expose your own corpus to external AI agents via a
>   personal API key — your context, usable by whatever AI tools you choose.
>
> What ships today: capture, AI drafting (server + on-device), the Tree, Friends/visibility,
> search, export, MCP. What's explicitly _not_ shipped: the "close the loop" stuff —
> an insight engine and one-click automations that act on your behalf. That's the north
> star, and I'd rather say so than oversell it.
>
> Happy to go deep on the on-device model integration, the queue design, or the embedding
> pipeline in the comments.

---

## X thread

**1/**
> Most "save it for later" apps solve the easy half: saving.
>
> The hard half — actually making sense of what you saved — never happens.
>
> So we built Sirius to do the second half. Capture anything, get something worth keeping.
>
> Your life, in context. 🧵

**2/**
> Capture _anything_: a link, a screenshot, a voice memo, a note, a repo, a YouTube video.
>
> In the app, or straight from the iOS Share Sheet — no app-switching. Share anything
> into Sirius and keep moving.

**3/**
> Then Sirius drafts it.
>
> Every capture becomes a clean, structured post — title, summary, tags, the works.
>
> AI drafts it. You decide what's worth keeping.

**4/**
> On iPhone, that drafting can run **entirely on-device.**
>
> No server round-trip. Private things stay on your phone. That's not a setting we bolted
> on — it's how it works.

**5/**
> Your captures don't just pile up. They get mapped by meaning.
>
> The **Tree** shows your whole library as a living shape — related ideas grouped, a 3D
> space you can actually explore. You finally see what you've been collecting.

**6/**
> It's yours. Every original you upload is retained privately. One tap exports the whole
> archive to your inbox.
>
> No ads. No cross-app tracking. Power users can even plug their corpus into their own AI
> tools via a personal MCP key.

**7/**
> The bigger idea: Sirius is a **life-context engine.** The longer you use it, the more it
> understands what matters to you.
>
> Most apps store. Sirius understands — and, increasingly, helps you close the loop.

**8/**
> Live today on iPhone + web. Capture, draft, organize, search, share, export — all
> shipping now. (The automation roadmap is next, and we'll say so honestly.)
>
> Feel lesswhelmed → lesswhelmed.com

---

## LinkedIn

> **Your "read it later" pile became another thing to be overwhelmed by. Same.**
>
> I kept saving things — articles, screenshots, voice memos, links I swore I'd get to.
> Capturing was easy. Making sense of any of it never happened. The pile just grew.
>
> So we built Sirius to do the part that doesn't happen on its own.
>
> You capture anything — in the app or straight from your phone's Share Sheet — and
> Sirius drafts it into a clean, structured, titled, tagged post. You review and keep
> what's worth keeping. On iPhone, the drafting can run entirely on-device, so private
> things stay private.
>
> Then it organizes everything by meaning — a "Tree" of your whole library so you can
> finally see the shape of what you've collected. You own every original. One tap exports
> all of it.
>
> The idea underneath: Sirius is a **life-context engine**. The longer you use it, the
> more it understands what actually matters to you. Most tools store what you save.
> We're building one that understands it.
>
> Capture, drafting, organizing, search, and export are live today on iPhone and web.
> The automation roadmap — helping you act on your context — is what's next, and I'll
> always be straight about what's shipped vs. coming.
>
> If your saved-things pile has quietly become a stressor, give it a try.
>
> **Your life, in context. Feel lesswhelmed.** → lesswhelmed.com

---

## Launch email

**Subject:** Sirius is live — capture anything, keep what matters

**Preview text:** Your life, in context. The pile finally makes sense.

**Body:**
> Hi {{first_name}},
>
> Sirius is live today — on iPhone and at lesswhelmed.com.
>
> Here's the simple version. You capture anything — a link, a screenshot, a voice memo,
> a note, a video — in the app or straight from your phone's Share Sheet. Sirius drafts
> it into a clean, structured post. You review and keep what's worth keeping. That's the
> whole loop, and it takes seconds.
>
> A few things we're proud of:
>
> - **On-device drafting on iPhone** — private things never leave your phone.
> - **The Tree** — your whole library mapped by meaning, so you can finally see what
>   you've been collecting.
> - **Yours, fully** — every original retained privately, one-tap export, no ads, no
>   tracking.
>
> The bigger idea: Sirius is a life-context engine. The longer you use it, the more it
> understands what matters to you. We're being honest about what's shipped (everything
> above) and what's next (helping you act on your context — the roadmap).
>
> Capture one thing today. See if the draft is worth keeping.
>
> **Feel lesswhelmed.**
>
> → Get Sirius: lesswhelmed.com
>
> — The Sirius team

---

## Press / boilerplate blurb

> **Sirius** is a life-context engine for iPhone and web (lesswhelmed.com). It lets people
> capture anything — links, photos, notes, code, videos, even voice memos — and uses AI
> to draft each capture into a clean, structured post the user reviews and keeps, with
> drafting able to run entirely on-device on iPhone. Captures are organized by meaning
> into a navigable map of the user's corpus, searchable and privately owned, with one-tap
> full export. Where other tools store what you save, Sirius is built to understand it —
> and, on its roadmap, to help you act on it. Sirius's promise is simple: your life, in
> context. Feel lesswhelmed.

---

## App Store

**Promotional text (≤170 chars):**
> Capture anything — links, photos, notes, voice memos — and Sirius drafts it into
> something worth keeping. On-device on iPhone. Your life, in context.

**What's New (release note):**
> Sirius is here. Capture anything from the app or the Share Sheet, and we'll draft it
> into a clean, structured post you review and keep — with drafting that can run entirely
> on your iPhone. See your whole library mapped by meaning in the Tree, search across it,
> share with friends or keep it private, and export everything anytime.
>
> This is the foundation of a life-context engine: the more you capture, the more Sirius
> understands what matters to you. Feel lesswhelmed.

**Subtitle (≤30 chars):**
> Your life, in context

**Keyword field (≤100 chars):**
> second brain,AI notes,save links,note capture,read later,knowledge base,personal AI,context
