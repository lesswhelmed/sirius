# Sirius — App Blueprint (code-grounded)

_A corrected, code-verified blueprint of the actual app. Supersedes any spec reverse-engineered
from a screen recording — those get the look right but guess the internals. Last updated 2026-07-01._

> **What it is:** Sirius is a content-ingest + AI publishing app — a private "life-context
> engine." You capture anything (links, photos, notes, code, videos, docs, voice); a background
> worker drafts each into a structured post with Gemini and writes it straight to Postgres, where
> the web + mobile apps serve it. Private by default; you review before anything is kept.

---

## 1. Design system (verified against the codebase)

Aesthetic: **"a well-set newspaper, not a SaaS dashboard." Flat, ruled, editorial.** One shape
language, two themes.

**Color — light "paper-and-ink" (default):** Paper `#f3ecdc` · Raised `#eadfc6` · Ink `#1c1612`
· Muted ink `#5a4f43` · Oxblood action `#8b2e2a` · Mustard `#c89530` (text `#876012`) · Sage
`#4a6741` · Steel `#3f5774`.

**Color — dark "midnight-navy" (from the app icon):** Ground `#131923` · Raised `#1b2230` ·
Sunken `#0d121a` · Ink `#e9ebdb` · Cat's-eye sage-gold glow `#cfd4b0` (text `#d9a847`) ·
Steel-blue `#7d99c4` · Oxblood action `#e0726a` · Sage `#8fab80`.
_(The reverse-engineered `#0A0E14` / "dusty rose" was a guess — these are the real tokens.)_

**Type — three faces:** Newsreader (serif, body/UI) · Instrument Serif (display headlines) ·
JetBrains/Geist Mono (labels, timestamps, roman folios). iOS: New York + SF Mono.

**Editorial rules:** zero border-radius everywhere (only true pills + the Apple badge are round);
hairline 1–1.5px rules instead of shadows; flat ground/raised/sunken surfaces; roman-numeral
folios + mono captions as the signature motif. The sage-gold glow is the one deliberate dark-mode
accent; oxblood marks the single primary action per surface.

**Components:** custom `@repo/ui` + per-app components — **not** shadcn/Radix. Web renders post
bodies with **Streamdown**; mobile has bespoke components (e.g. `Collapsible`).

---

## 2. Data model (real Prisma schema)

- **`PostType` enum:** `CONCRETE · BLOG · FINDING · SIGHT · SOCIAL`.
  _(There is **no `DISPATCH`** type — that was invented. Quick notes → `BLOG`; social embeds →
  `SOCIAL`.)_ The worker **forces the type after the model returns** so a model regression can't
  drift it: URL → `FINDING`, images → `SIGHT`, note → `BLOG`, Instagram/Twitter → social paths.
- **`PostStatus`:** `PUBLISHED · DRAFT · ARCHIVED`.
- **Per-post visibility:** `PRIVATE · FRIENDS · GROUP · PUBLIC` (private by default).
- **`IngestSubmission`** is the producer/consumer queue row: state machine
  `pending → processing → completed | failed`, with a dedup `contentHash`, optional
  `submittedById`, `batchId` for image batches, and `retainedFilePath` for the kept original.
- **`Post`** carries `title`, `content` (MDX/markdown — the analysis lives inline here, see §3),
  `type`, `status`, visibility, slug, tags/categories (connect-or-create), and a generated
  `searchVector` tsvector. **`PostEmbedding`** holds the semantic vector (Gemini) used for
  similarity + search.

Access is wrapped in `@repo/db` domain helpers (`ingest.ts`, `posts.ts`, `search.ts`, …) over
Prisma 7's **driver adapter** (`@prisma/adapter-pg`), not the classic engine.

---

## 3. The AI processing layer — and the "Full analysis" feature

Drafting runs in the **worker** (a long-running Bun daemon), not in a request. It uses the
**Vercel AI SDK** (`generateText` + `Output.object(zodSchema)`) with **Gemini** — schema-validated
output, no hand-parsed JSON. _(The inferred "Instructor / Python" backend was wrong.)_

### What each capture type actually produces

| Capture | Path | Output |
|---|---|---|
| **YouTube** | `youtube/` | **Full structured analysis** (six blocks, below). Type `FINDING`. |
| **Instagram** | `instagram/` | A **different** structured digest (visual summary, subjects, objects, people, claims). Not the six-block analysis. |
| **Twitter/X** | `twitter/` | Light — one-call draft into the shared draft schema. Type `SOCIAL`. |
| **Generic URL** | `url_context` two-step | Light summarized `FINDING` (fetch → summarize → structure). |
| **Note** | notes path | Light `BLOG` draft. |
| **Images** | image batch | Light `SIGHT` (60–160-word description + per-image alts, OCR pre-pass). |

> **Honesty rule for marketing:** only **videos (YouTube)** get the multi-block **Full analysis**.
> Everything else is a lighter (still structured) draft. Never claim "every capture gets a full
> analysis."

### The "Full analysis" (YouTube) — the standout

A separate, dedicated Gemini call (Pro-tier model) validates against `YouTubeAnalysisSchema` and
produces **six blocks**:

1. **overview** — 2–4-paragraph plain-prose summary.
2. **keyClaims** — discrete, falsifiable assertions, each with a nullable `startSeconds`.
3. **toolsAndFrameworks** — `{name, purpose}` for each software/method/product named.
4. **notableMoments** — `{startSeconds (required), title, description}` — demos, pivots, conclusions.
5. **quotes** — up to ~10 verbatim `{text, speaker?, startSeconds?}`; model told to omit rather
   than paraphrase.
6. **entities** — `{name, kind}` where `kind ∈ {person, organization, product, concept, place,
   work}` (deduped, ~25 cap). _(Note the 6th category **`work`** — books/papers/films.)_

**Storage:** it is **not** a separate DB field. The worker renders the blocks to markdown and wraps
them in nested HTML `<details>/<summary>`, then appends to `Post.content`:
```
<details><summary>Full analysis</summary>
  ### Overview / ### Key claims / ### Tools and frameworks / ### Notable moments / ### Quotes / ### Entities
  <details><summary>Raw evidence summary …</summary> … </details>
</details>
<details><summary>Transcript (lang)</summary> … </details>
```
Timestamps render as clickable deep-links back into the source video (`m:ss` / `h:mm:ss`).

**Rendering:**
- **Web** (`app/(app)/posts/[slug]/page.tsx`): the body goes through **Streamdown**, which renders
  the raw `<details>` as a **native browser accordion**. There is no bespoke React accordion and no
  hardcoded "Full Analysis" label — the label is the worker's `<summary>` text.
- **Mobile** (`lib/post-blocks.ts` → `components/post-body.tsx` → `Collapsible`): a stack-based
  parser turns the body into an ordered `Block[]` (`markdown` / `youtube` / `details`) and renders
  each `details` as a native **`Collapsible`** (serif summary, hairline rule, rotating chevron,
  collapsed by default).

**The real label is "Full analysis"** (lowercase "a"), defined once in the worker. The `entities`
block is **display-only** — it does **not** feed an entity graph or the related-posts engine.

---

## 4. Surfaces / navigation (what the recording showed)

- **Post detail** — title (display serif) + body (Streamdown/blocks) with the collapsible **Full
  analysis** on videos; edit/delete actions tucked in a drawer; a **Related** rail (up to 6).
- **The Catalog** — the private library: counters ("N on file", per-category counts), segmented
  filter pills, a unified card feed (thumbnail + type badge `FINDING`/`SIGHT` + category + tags).
  Web `/catalog`; mobile Library tab. **Private archive only.**
- **The Tree / Observatory** — the corpus mapped by meaning: taxonomy outline + (web) a 3D
  embedding "space", drill into any node's posts. Web `/space`; mobile **Tree** tab
  (route `tree`, canvas-free). Owner-scoped.
- **Friends hub + shared feed** — merged feed of your shared posts + friends', with
  `People →` / `Groups →`; per-post `PRIVATE/FRIENDS/GROUP/PUBLIC`; own rows carry an owner-only
  audience badge. Web `/friends`; mobile **Friends** tab (route `feed`).
- **Queue** — the live ingest state machine (`pending → processing → done/failed`).
- **Explore / Connections** — related-topics + related-posts surfacing.

_(The "ROOT / analysis" text map glimpsed at 0:16 is the taxonomy/outline view of the
embedding-scene, not a filesystem router.)_

## 5. Related posts & search (real mechanics)

- **Curated search** (`@repo/db searchCorpus`): Postgres **full-text** (`ts_rank` over the
  field-weighted `searchVector` + GIN) **fused with embedding cosine** via **Reciprocal Rank
  Fusion (RRF, K=60)**, visibility-gated, with `exact`/`similar` badges. Degrades to FTS-only if
  the embedding backend is down.
- **Related posts** (embedding-scene): post↔post **kNN cosine** similarity edges + shared
  matched-**category** overlap edges (from the classification pipeline). `via {topic}` captions the
  strongest shared category. **pgvector is deferred** — today it's brute-force cosine behind a
  swap seam.

---

## 6. Actual tech stack (corrections to the inferred one)

| Inferred | Reality |
|---|---|
| Next.js 14 | **Next.js 16** App Router (web), **Expo / React Native** (mobile), **Bun daemon** (worker) |
| Radix / shadcn | **Custom `@repo/ui`**; web body via **Streamdown**; mobile bespoke components |
| Tailwind (unversioned) | **Tailwind v4**, **React 19**, **TypeScript ~6**, **Zod 4** |
| PostgreSQL + pgvector | **PostgreSQL + Prisma 7 driver adapter**; **FTS + brute-force embedding cosine (RRF)**; **pgvector deferred** |
| Instructor (Python) for structured JSON | **Vercel AI SDK `generateText` + `Output.object(zod)` + Gemini**, in a **Bun/TypeScript worker** |
| — (missed) | **Expo mobile app with on-device `llama.rn` drafting**; **better-auth** (email+verify, admin+expo plugins); **bun+turbo monorepo**; **ingest queue/worker**; **MCP corpus server** (`apps/mcp`); **retained originals + one-tap export**; media served via `/sight` + `/social` |

---

## Appendix — what the screen-recording blueprint got right vs wrong

**Right:** the editorial dark aesthetic, serif-display + mono, square tag pills, data density; the
`FINDING`/`SIGHT` types; the six-block Full-analysis structure; Catalog counters + filter pills +
card feed; Friends/Groups feed; "related posts via embedding similarity."

**Wrong / imprecise:** invented a `DISPATCH` type (real: `CONCRETE/BLOG/FINDING/SIGHT/SOCIAL`);
guessed the palette; label is "Full analysis" not "Full Analysis"; implied analysis is universal
(it's **video-only**); missed the 6th entity category `work`; claimed the entity block powers a
graph (it's display-only); and the whole stack recommendation (Next 14 / Radix / Instructor-Python
/ pgvector) doesn't match the real stack above.
