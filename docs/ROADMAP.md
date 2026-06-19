# Sirius / Lesswhelmed — Roadmap

> Source vision: [`initial-vision.md`](../initial-vision.md). This document maps that
> 4-phase product vision onto the **shipped** codebase as an honest gap analysis and a
> sequenced path forward.

## Intro

The vision is to turn lesswhelmed from an information _processor_ into a proactive partner
that understands a user's aspirations and **turns information into action, insight, and
peace of mind**. The four phases are: (1) Aspiration Core — teach the system the user's
goals; (2) Universal Collector — ingest from anywhere; (3) Insight Engine — synthesize the
pool into opportunity; (4) Automation Engine — close the loop and act on the user's behalf.

A surprising amount of the _foundation_ is already shipped. The producer/consumer ingest
queue (`IngestSubmission` → worker `pipeline/pipeline.ts`) already drafts posts with Gemini,
and the **auto-org** stage (`apps/worker/src/pipeline/classification/assign-org.ts`) already
embeds, classifies against a user-grown taxonomy and the user's Projects, and auto-creates
Aspiration/Project rows. What is mostly _missing_ is the **proactive, user-facing surface**:
intake questions, a briefing/opportunity dashboard, cross-content synthesis, and automations.
The honest summary: Phase 1 is ~70% built (data model + auto-org done, intake/UX gaps),
Phase 2 is ~90% built (multi-format ingest done; social/email/OCR gaps), Phase 3 is ~40%
built (on-device "ask my posts" + Tree taxonomy exist; no dashboard/synthesis), Phase 4 is
~10% built (one-off draft actions exist; no suggested-actions menu or automations).

---

## Phase 1 — The Aspiration Core (Building the Brain)

### Shipped

- **Aspiration & Project / Focus-Area data model is fully built.** `schema.prisma` has
  `Aspiration` (title, description?, ownerId, projects[]) → `Project` (a.k.a. "Focus Area":
  title, description?, status, ownerId, aspirationId?, posts[]) → `Post.projectId?`. The
  hierarchy the vision describes exists today.
- **Auto-org "brain" already runs on every session-auth ingest.**
  `apps/worker/src/pipeline/classification/assign-org.ts` embeds each post, reverse-looks-up
  against the user's existing `Project`s and the dynamic topic taxonomy, persists
  `PostEmbedding` + `PostCategoryMatch`, and — for unscoped ingests — assigns the best Project
  or **auto-creates an Aspiration + Project** when none matches. This is the contextual "why
  is this important" link the vision asks for, already automated.
- **Full CRUD surface for both.** DB helpers in `packages/db/src/projects.ts`
  (`createAspiration`, `listAspirations`, `createProject`, `assignPostToProject`,
  `mergeProjects`, `listProjectsWithCounts`, …); web routes `/api/app/aspirations` and
  `/api/app/projects` (+ `/merge`); web pages `(app)/aspirations/aspirations-board.tsx` and
  `(app)/projects/projects-board.tsx`.
- **Per-ingest scoping exists.** `IngestSubmission.projectId` lets a capture be pinned to a
  Focus Area at submit time (mobile composer + web ingest), bypassing auto-assignment.

### Gaps

- **No guided aspiration-setup / onboarding flow.** Aspirations exist as a board you can
  CRUD, but there is no "guided setup" that walks a new user through defining big-picture
  goals (vision Phase 1, Feature 1). Today only `setup-handle` is forced post-signup.
- **No Customizable / dynamic Intake Questions.** There is no `IntakeQuestion` model, no
  per-ingest question prompts ("Which project does this relate to?", "Key takeaway for your
  Thought Leadership goal?"), and no user-defined question library. Grep confirms zero
  `intake`/`question` surface. This is the vision's "primary mechanism for training the AI"
  and it is entirely unbuilt.
- **No objectives per Project.** Projects have status + description but no structured
  objectives/key-results the vision implies ("Each project can have its own set of
  objectives").

### Next

- Add an onboarding step in `(app)/layout.tsx` (alongside `requireSession` →
  `/setup-handle`): redirect to `/setup-aspirations` until the user has ≥1 Aspiration; reuse
  the existing `createAspiration` helper.
- Introduce an `IntakeQuestion` model (ownerId, prompt, scope: global | projectId, type:
  text | choice) + `IngestAnswer` (submissionId, questionId, value). Surface a question
  library in `/settings`.
- At submit time, have the worker (or a synchronous `/api/app/extract` pre-pass) **suggest**
  questions based on the user's active Projects + the classification signal, and persist
  answers onto the `IngestSubmission.payload` so `assignOrg` can weight them.
- Add a lightweight `objectives` Json field (or child rows) to `Project`; thread into the
  classification input in `classification/adapters.ts`.

---

## Phase 2 — The Universal Collector (Expanding the Senses)

### Shipped

- **Multi-format ingestion is largely done.** `IngestSubmission.kind` already supports
  `url | image | note | video | audio | document`. Web `apps/web/lib/ingest/submit.ts`
  routes URL/note via `/api/app/ingest`, image batches via `/api/app/ingest-images`, and
  reference-only file kinds (video/audio/document) via `/api/app/ingest-file`. The worker
  branches on kind in `pipeline/pipeline.ts`.
- **Specialized extractors already ship.** Dedicated worker paths for Instagram
  (`pipeline/instagram/`, Apify), YouTube (`pipeline/youtube/`, transcript/chunk), and
  GitHub (`packages/github-ingest` + `pipeline/github/`), all falling back to `url_context`.
  URL extraction is shared via `@repo/extraction`.
- **Frictionless capture surfaces exist.** Mobile composer tab + bearer-token endpoints
  (`/api/ingest`, `/api/ingest-images`) for iOS Shortcuts. Originals are **retained** to a
  private store (`ORIGINALS_DIR`) with owner-gated retrieval.

### Gaps

- **No social one-click share beyond Instagram.** The vision names X/Twitter and LinkedIn;
  only Instagram has a dedicated path. Others fall through to generic `url_context`, which
  loses author/thread structure.
- **No email-to-ingest address.** "Forward an email to a personalized lesswhelmed address"
  is unbuilt — there is no inbound-email ingest endpoint.
- **OCR for images/screenshots is implicit, not explicit.** Image batches go to Gemini as
  inline parts (vision reads them), but there is no dedicated OCR text-extraction step that
  makes screenshot text first-class/searchable.
- **Document parsing is reference-only.** `kind: document` is retained and referenced but
  not deeply parsed (PDF/Word → structured text) the way the vision implies.

### Next

- Add an inbound-email worker path: a per-user ingest address (Resend inbound or a mailbox
  poller) → `createSubmission({ kind: "note", submittedById })`. Reuse the dedup hash.
- Add X/LinkedIn extractor adapters mirroring `pipeline/instagram/` (or an oEmbed/readability
  pre-pass), gated behind a single-URL host check like the Instagram branch.
- Make OCR explicit: in the image branch, run a text-extraction pass and store it on the
  Post body / a searchable field so screenshot text feeds embeddings + research.
- Add a PDF/Office parser step for `kind: document` (structured text → same draft pipeline).

---

## Phase 3 — The Insight Engine (Data Pool → Opportunity Dashboard)

### Shipped

- **FINDING posts already exist.** URL ingest is forced to `PostType.FINDING` by the worker;
  the "findings" primitive the vision wants to overhaul is in place.
- **The Tree / Observatory is the first cut of the "Resource Hub".** `/space`
  (`(app)/space/space-view.tsx`) + the mobile **Tree** tab (`(tabs)/tree.tsx`) render the
  embedding taxonomy (categories, Focus Areas, drill-into-Index of posts), sharing all
  shaping logic via `@repo/embedding-scene` and fed by `/api/app/embedding-scene`. Items are
  already "intelligently tagged, categorized by project and topic."
- **"Scan your own pool" is partially built — on-device.** `@repo/research-agent` +
  `apps/mobile/src/lib/research/*` implement an **"ask my posts"** assistant: embed a query
  on-device, rank the user's local post-vector index by cosine similarity, and stream a
  grounded answer that **cites** the matching posts. Wired into the mobile `llm.tsx` "ask"
  mode. This is the kernel of the vision's "scan the user's entire existing pool" feature.

### Gaps

- **No Opportunity Dashboard / home screen.** The shipped home is a library/queue, not a
  curated, actionable surface. No "home" that aggregates by top projects.
- **No "Daily Briefing".** Nothing summarizes the last 24h of captures against top projects.
  Grep confirms no briefing/digest surface in `apps/web` or `apps/worker`.
- **No "Connect the Dots" cross-content synthesis.** We compute post↔category and
  post↔project similarity, but nothing surfaces _post↔post_ hidden relationships
  ("this new article supports a note from last month").
- **Research is mobile-only and query-driven, not server-side or proactive.**
  `@repo/research-agent`'s `runResearchAgent`/web WebLLM path is noted as a _future_ host;
  there is no server-side research endpoint, and no synthesized **report** output (summaries
  - key quotes + source links) — only a streamed chat answer.

### Next

- Build a server-side `/api/app/briefing` that, per user, selects recent `Post`s scoped to
  active Projects (reuse `listProjectPosts` + `PostEmbedding` recency) and Gemini-summarizes
  them; render as a Dashboard home in `(app)`.
- Add a **post↔post similarity** job in the worker (after `assignOrg`): nearest-neighbor over
  `PostEmbedding`, persist top links (new `PostLink` model), surface as "Connect the Dots".
- Promote research server-side: a `/api/app/research` route composing
  `searchPosts` + `streamResearchAnswer` over the server `PostEmbedding` index, emitting a
  **synthesized report** (sections, quotes, citations) rather than a chat turn.
- Unify the Tree "Index" + research citations into the Resource Hub view.

---

## Phase 4 — The Automation Engine (Closing the Loop)

### Shipped

- **Draft generation is the proven primitive.** The worker already drafts BLOG/FINDING/SIGHT
  posts; mobile already drafts on-device (`tryClientDraft` in `pipeline/draft-runner.ts`,
  `@repo/ingest-draft` wire schema). "Generate a blog post outline" / "draft a post" is, in
  effect, what the pipeline does today.
- **The ask-my-posts assistant can already produce action-shaped text** (a grounded answer
  about a finding), which is the substrate for "draft a tweet about this finding."

### Gaps

- **No One-Click Actions menu.** There is no per-item suggested-next-steps surface ("Draft a
  tweet", "Add to To-Read", "Draft an email to [Colleague]", "Create a task"). No action
  registry, no learned-preference model.
- **No task / to-do primitive.** "Create a task in my To-Do list" and "Add to To-Read" have
  no model to write to.
- **No Automations / if-this-then-that engine.** Nothing lets a user define rules
  ("if tagged Q4 + Competitor → add to doc", "if >3 ML articles/week → email a digest").
  No rule model, no scheduler, no trigger evaluation. Grep confirms zero automation surface.
- **No outbound action connectors** (email-send-as-user, post-to-X, write-to-doc) beyond
  Resend transactional + archive email.

### Next

- Add a `Task`/`SavedAction` model and a per-Post **actions menu** in web + mobile, each
  action a typed handler (draft-tweet, draft-email, add-to-read, create-task) reusing the
  existing Gemini draft path for the generative ones.
- Track chosen actions per content-type to learn preferences (simple frequency table first).
- Introduce an `Automation` model (ownerId, trigger spec, condition, action) + a worker
  evaluator on the existing poll loop; start with deterministic tag/threshold triggers and
  the digest-email action (reuse Resend + the Phase 3 briefing summarizer).
- Add outbound connectors incrementally (email-send first, social later), gated by per-user
  consent.

---

## Sequencing — Ordered, Dependency-Aware Build Order

Each step unblocks the next; later phases reuse earlier primitives.

1. **Phase 1 — Intake Questions + onboarding.** The vision's "primary AI-training mechanism."
   `IntakeQuestion`/`IngestAnswer` models + suggested questions feed richer signal into the
   _already-built_ `assignOrg`. Unblocks better classification everywhere downstream.
2. **Phase 2 — close capture gaps** (email-to-ingest, X/LinkedIn, explicit OCR, doc parsing).
   Independent of #1 and parallelizable; each widens the pool the Insight/Automation engines
   draw from. OCR/doc parsing is a prerequisite for those captures to be searchable in #4.
3. **Phase 3a — server-side embeddings + post↔post links.** Lift research server-side and add
   the nearest-neighbor `PostLink` job. Depends on `PostEmbedding` (shipped). Unblocks both
   "Connect the Dots" and the briefing.
4. **Phase 3b — Daily Briefing + Opportunity Dashboard home.** Depends on #3a (links) and #1
   (project scoping/objectives sharpen "top projects"). Becomes the new home surface.
5. **Phase 4a — One-Click Actions + Task model.** Hangs the actions menu off the Dashboard
   from #3b; reuses the shipped draft pipeline for generative actions.
6. **Phase 4b — Automations engine.** The capstone: a rule model + worker evaluator on the
   existing poll loop, composing the digest summarizer (#3b) and action handlers (#4a) into
   if-this-then-that sequences. Must come last — it orchestrates everything before it.

### Already done in this change

- **Marketing page redesign.** `(marketing)/product/` now leads with a **screenshot
  carousel** of real in-app captures (`_sections/hero-carousel.tsx` + `SCREEN_SLIDES` in
  `(marketing)/constants.ts`), replacing the old looping demo video — pure CSS/React,
  reduced-motion aware. The marketing **header is logged-in-aware**:
  `(marketing)/layout.tsx` streams in a signed-in variant via `getSessionOrNull` +
  `getUserHandle` (static fallback for logged-out, no layout shift).
- **Vision doc ingested as real content.** `initial-vision.md` was submitted through the live
  ingest pipeline under the dev account (`saleebmina@icloud.com`) so it exists as an actual
  Post / Finding in the owner's pool — dogfooding the very flow this roadmap plans against.
