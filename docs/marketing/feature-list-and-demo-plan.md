# Sirius — Feature List, Use Cases & Demo-Video Plan

_Non-technical reference, grounded in `docs/launch/`. Last updated 2026-06-30._

> **Sirius — Your life, in context.** Capture anything. AI drafts it into something worth
> keeping. The more you use it, the more it understands. **Feel lesswhelmed.**

**Honesty rule (carried from the launch docs):** everything in "Ships today" is real and
demoable. The "North star" items are roadmap and must never be shown as if they work today.

---

## 1. The one-stop pitch — why Sirius is the single place

Most people use five tools to do what Sirius does in one: a bookmark app for links, Photos
for screenshots, a notes app for thoughts, a read-later app for articles, and a separate AI
chatbot to make sense of any of it. Each one only **stores**. None of them understand *why*
a thing mattered to you, and nothing ever turns the pile into something useful.

Sirius is the one place where **anything you capture becomes something worth keeping** —
automatically drafted, organized by meaning, searchable, private by default, and entirely
yours to export. One capture box. One library. One map of everything you care about.

The single sentence: **"Capture anything. Get something worth keeping. On your terms."**

---

## 2. Full feature list (non-technical) — Ships today

### A. Capture anything, from anywhere
- **Capture tab** — one box that accepts links, photos/screenshots, typed notes, code
  repos, YouTube videos, documents, and voice memos. No blank page, no "which app does
  this go in?"
- **iOS Share Sheet** — share anything from any app straight into Sirius, no app-switching.
  Reading an article, see a photo, watch a clip → share → done. (The "no-app" superpower.)
- **Voice capture** — talk instead of type; Sirius drafts from the voice memo.
- **Nothing gets lost** — every capture lands in a live **Queue** that shows its status
  (waiting → drafting → done), so you can always see what's in flight.

### B. AI drafts it into something worth keeping
- **Automatic drafting** — every capture comes back as a clean, structured post: a title, a
  summary, tags, categories, and a body. You never start from a blank page.
- **Auto-sorted by type** — Sirius figures out what each capture *is*:
  - **Finding** — from a link/URL (it reads the page and summarizes it for you).
  - **Sight** — from a photo or a batch of images.
  - **Blog** — from a typed or spoken note.
  - Plus dedicated handling for **Instagram posts** and **YouTube videos**.
- **On-device drafting on iPhone** — the AI can run **entirely on your phone**, so the
  capture never leaves the device. Privacy as a default, not an upsell.
- **You review before anything is kept** — AI drafts; *you* decide. Nothing is ever
  published silently. "AI drafts it. You decide what's worth keeping."

### B★. Deep video analysis — the "Full analysis" (the standout)
> Share a **YouTube video** and Sirius doesn't just summarize it — it produces a full,
> structured breakdown you can expand right inside the post. This is the "wow" feature.

- **Full analysis** (a collapsible section on video posts) contains, automatically:
  - **Overview** — a plain-prose summary of the whole video.
  - **Key claims** — the discrete, checkable assertions the video makes, each with a
    jump-to timestamp.
  - **Tools & frameworks** — every product, method, or framework named, with a one-line
    "what it's for."
  - **Notable moments** — the demos, pivots, and conclusions worth jumping to, each a
    tappable timestamp.
  - **Quotes** — up to ~10 verbatim quotes that capture the video's voice, with speaker +
    timestamp.
  - **Entities** — the people, organizations, products, concepts, places, and works
    mentioned, categorized.
- **Timestamps are deep-links** — tap any moment/quote to jump straight to that point in
  the source video.
- Also kept, collapsed: the **raw evidence summary** and the **full transcript**.

> **Honesty scope (say this accurately):** the multi-block **Full analysis is for videos
> (YouTube)**. Instagram captures get a *different* structured digest (subjects, objects,
> claims); links, notes, and images get a clean summarized draft — rich, but not the
> six-block Full analysis. Don't claim "every capture gets a full analysis."

### C. Context that compounds — organize, map, find
- **Catalog** — your whole private library in one place, draft → published, private by
  default. Your archive of everything worth keeping.
- **The Tree / Observatory** — your entire corpus mapped **by meaning**: an outline of
  topics plus a 3D "space" you can explore, with related posts grouped together. (Web:
  Observatory at `/space`; mobile: the Tree tab.) Lets you *see* what your life is actually
  about.
- **Curated search** — find anything by **meaning, not just keywords**. Combines exact
  word-match and "similar in meaning" results, with badges showing why each result matched.
- **Connections / Explore** — surfaces related captures and topics so you rediscover things
  you forgot you saved.

### D. Share on your terms (or keep it all private)
- **Friends hub + shared feed** — a feed separate from your private library, for the things
  you choose to share.
- **Per-post visibility** — each post is **Private / Friends / Group / Public**. Private by
  default; you open the door only when you want to.
- **Named friend-groups** — share to "Work," "Family," or any group you define.
- **Public page** — optionally publish a public catalog at `lesswhelmed.com/catalog/<your
  handle>` — a personal page with no website to build.
- **Invite-share** — a polished invite card + QR + public landing page for bringing people in.

### E. Your data, your terms
- **Originals always retained** — every file you upload is kept privately *for you*, not
  thrown away after processing.
- **One-tap full export** — export *everything* (your originals + notes), delivered as an
  emailed download link. No lock-in, ever.
- **No third-party ads. No cross-app tracking.**
- **MCP corpus server** — expose *your* corpus to the outside AI tools *you* choose (via a
  personal key), so your context works with the assistant you already use. Ownership, not a
  cage.

### F. Cross-platform + plans
- **Native iOS app + full web app** at `lesswhelmed.com` (Android build exists).
- **Free tier** — capture, catalog, search, the Tree; AI drafting up to a weekly cap.
- **Pro** — unlimited AI drafts, on-device drafting, MCP key, full export. (RevenueCat-backed.)

---

## 3. Use cases — who it's for and the moment it clicks

### The Overwhelmed Professional ("stop losing things")
- The screenshot graveyard in Photos finally becomes a searchable, summarized library.
- Tabs you "meant to read later" get captured, summarized, and filed automatically.
- End-of-week "what did I even do?" → it's all in the Catalog, organized by meaning.
- **Lands with:** _"Capture now. Sorted later. Feel lesswhelmed."_

### The Second-Brain Power User ("context + ownership")
- Keep your own data **and** get real AI structure — not a cloud-locked bolt-on.
- Map your corpus by meaning (the Tree), not by hand-maintained folders and tags.
- Feed *your* context into the AI agents you already use via the MCP key.
- **Lands with:** _"Your context, owned — and usable by the AI you choose."_

### The Creator ("capture → publish")
- Share-sheet inspiration the second you see it; turn raw input into a publishable draft.
- A clean private → public path: keep most of it, publish some to your public catalog.
- A public page with no site to stand up.
- **Lands with:** _"Everything you capture, drafted into something worth keeping."_

### Everyday cross-cutting moments
- **Research a topic:** dump 10 links + a few notes; come back to summarized findings mapped
  together.
- **Trip / project log:** photos + voice memos + links become an organized, searchable thread.
- **Recipe / reference hoard:** screenshots become titled, tagged, findable posts.
- **Reading list that actually gets read:** articles come back pre-summarized to triage fast.

---

## 4. North star (roadmap — NOT shipped; never show as working)
- **Aspiration Core** — your goals/projects as first-class context, so Sirius knows *why* a
  capture matters.
- **Insight Engine** — an Opportunity Dashboard + "Connect-the-Dots" that scans your entire
  private corpus.
- **Automation Engine — "Closing the Loop"** — one-click suggested actions and
  if-this-then-that Automations that act on your behalf.

> In any asset, label these explicitly as "where we're headed." The brand earns the future
> by being precise about the present.

---

## 5. Demo-video plan

### 5.0 Build on what exists
There is already a self-produced hero video pipeline feeding the web `/product` page:
`scripts/marketing/build-demo-video.sh` (+ `render-captions.md`). Reuse it. Known gotchas
(from `marketing-demo-video-pipeline` memory): Homebrew ffmpeg has no `drawtext`/`subtitles`
(burn caption PNGs rendered in a headless browser, then `overlay`); PNG overlays need
`-loop 1 -t <dur>`; `say -v Samantha` is the available voiceover voice; the static `/product`
page caches its prerender (restart dev server / prod build to see changes).

### 5.1 The core idea
**One thesis, shown not told: "Capture anything → get something worth keeping."** The hero
demo is the *transformation* — messy input becoming a clean, organized, findable post — not
a feature tour. Lead with the universal hook; let segments self-select.

### 5.2 Recommended primary cut — 60–75s hero video (App Store + web + social anchor)

| Beat | Time | On screen | Voiceover / caption |
|---|---|---|---|
| **1. The problem** | 0–8s | Fast montage: a chaotic Photos grid, 30 open tabs, a notes app full of fragments | "We capture more than ever — and understand less of it." |
| **2. The capture (the hook)** | 8–20s | iPhone: an article in Safari → **Share Sheet → Sirius**. Then a photo shared. Then a quick voice memo. | "Capture anything — a link, a photo, a thought — right where you are." |
| **3. The magic moment** | 20–38s | The Queue ticks pending → done; a capture **blooms into a clean post** (title, summary, tags appear). Show the on-device draft badge. | "Sirius drafts it into something worth keeping. On iPhone, entirely on-device." |
| **4. Review & keep** | 38–46s | A quick tap to review/approve the draft. | "AI drafts it. You decide what's worth keeping." |
| **5. It compounds** | 46–60s | The Catalog fills; cut to **the Tree / Observatory** rotating, related posts grouped; a search types a vague phrase and surfaces the right post by meaning. | "Everything, mapped by meaning — so you can actually find it later." |
| **6. Your terms + close** | 60–72s | One-tap export screen flashes; "No ads. No tracking." Then the wordmark + cat. | "Private by default. Yours to keep. **Your life, in context. Feel lesswhelmed.**" |

**Best use cases to feature (in this order):** Share-Sheet-a-link (universal), photo/screenshot
→ Sight (visual + relatable), voice memo (delight), then the Tree + search payoff (the "whoa,
it understands me" moment). These map 1:1 to the three message-house pillars: *capture →
context that compounds → your terms.*

### 5.3 Production approach (lowest-risk, highest-polish)
- **Montage real screenshots, don't live-record.** XCUITest pacing is erratic (~3–5s/press)
  and the AgentDeviceRunner adds a "Powered by callstack" splash. Capture clean stills via
  `simctl`, then assemble with ffmpeg `zoompan` + `xfade` for smooth motion. (Memory-backed.)
- **Use the reviewer/seed account** so the Catalog, Tree, and search look full and real, not
  empty. (`reviewer:seed:worker` enqueues real submissions through the live worker.)
- **Captions over heavy voiceover** for social (most watch muted); add the `say -v Samantha`
  voiceover for the web/App Store cut. Burn caption PNGs via the headless-browser route in
  the real brand fonts.
- **Brand look:** flat, ruled, editorial; cream/navy dual theme matching the cat/star icon;
  zero-radius. Calm, not hype. (Per `brand/02-visual-identity.md`.)
- **Music:** quiet, single-instrument, resolves on the payoff. No "epic launch" build.

### 5.4 Cut-downs to produce from the same footage
- **15s (Reels/TikTok/Shorts):** Problem (2s) → Share Sheet (4s) → bloom into post (5s) →
  Tree + tagline (4s). Captions only, muted-first.
- **6s bumper (pre-roll):** one capture → one clean post → wordmark. "Capture anything."
- **30s App Store preview:** beats 2–6 above, voiceover on, ends on download CTA.
- **Segment cuts (optional):** swap beat 5 emphasis — power-user cut ends on MCP + export;
  creator cut ends on the public `/catalog/<handle>` page.

### 5.5 Do / Don't (from the voice guide)
- **Do** show real transformation, concrete verbs (capture, draft, keep, map, find), and the
  on-device/privacy beat.
- **Don't** imply automation/"closes the loop today," use words like *supercharge/seamless/
  revolutionary*, or show an empty-looking corpus. Never show a North-star feature as if live.

### 5.6 Suggested production checklist
1. Pick length(s) + platform(s); lock the script from the table above.
2. Seed a demo account so every surface looks lived-in.
3. Capture clean stills of each beat (Share Sheet, Queue, post bloom, review, Tree, search,
   export) on iOS sim + web.
4. Render brand-font caption PNGs (headless browser, transparent bg).
5. Assemble with ffmpeg (`zoompan`/`xfade`, `-loop 1 -t` on overlays); add voiceover for the
   web/App Store cut.
6. Drop the hero cut into `/product`; restart the dev server / rebuild to clear the static cache.
7. Export the 15s / 6s / 30s variants from the same timeline.
