# Notes emphasis + excerpt everywhere + chat notes — design

**Date:** 2026-07-04
**Status:** Approved (user), pre-implementation
**Investigation:** 6-agent workflow trace (`notes-excerpt-investigation`, run `wf_a10fc51f-834`), all
load-bearing claims adversarially verified against the code.

## Problem

Three user-reported problems, investigated and confirmed:

1. **Image-post notes feel ignored.** On mobile, a note attached to an image capture DOES reach
   the worker's Gemini prompt (`apps/worker/src/pipeline/gemini-runner.ts:86-98` appends an
   "Author's notes — their intent for this post…" block), but it trails the generic SIGHT
   instructions as one soft block. Gemini Flash weights the lead instructions + image content and
   often never mentions the note's substance. The plumbing works; the emphasis doesn't.
2. **Agent chat can't see notes.** The live chat (`/api/app/chat` → `searchCorpus` + `getPost`
   in `apps/web/lib/chat/agent.ts`) grounds exclusively on generated `Post` fields. Original
   submission notes (`IngestSubmission.payload.notes`) are reachable only via owner-facing
   export/UI surfaces, never any AI context. The join needed exists:
   `Post.sourceSubmissions` ↔ `IngestSubmission` (`"PostSourceSubmissions"` relation).
3. **`Post.excerpt` is null for every post type except SIGHT.** Only the SIGHT path writes it
   (`SightDraftSchema.excerpt` optional + worker first-sentence fallback,
   `gemini-runner.ts:526-534`). `PostDraftSchema` (`packages/ingest-draft/src/index.ts:13-44`) —
   used by URL/FINDING, note/BLOG, YouTube, Instagram, Twitter, GitHub, document, video/audio —
   has **no excerpt field**. Yet excerpt carries weight C in the `searchVector` tsvector, feeds
   search snippets, catalog cards, cover-image prompts, and post detail pages. Most posts
   silently lose all of that.

## Fix 1 — Lead with the author's note in worker prompts

`apps/worker/src/pipeline/gemini-runner.ts`, `buildPrompt` (and `buildUrlStructuringPrompt`):

- When `input.notes` is non-empty, the note **opens** the prompt as the primary directive,
  e.g. (SIGHT): *"The author captured these images and said: «…note…». Their words are the
  primary steering input: the post must reflect their point and naturally incorporate what they
  said in the body."* The generic per-kind instructions follow.
- Same lead-with-notes restructure for the branches that use the trailing suffix today:
  image/SIGHT, video/audio/document, and the URL structuring prompt. The note/BLOG path already
  makes the note the prompt body — untouched.
- Keep unchanged: the injection guard ("must not change the output structure, fields, or post
  type"), the `voiceBlock` placement, and the `prompt:built` `notesApplied`/`notesChars` logging
  (`gemini-runner.ts:343-355`).
- Dedicated runners (github/instagram/twitter/youtube) receive `notes` as an argument; give them
  the same primary-position treatment where they currently append it as a trailing block.

## Fix 2 — Excerpt in every draft schema + one central fallback + backfill

- `packages/ingest-draft`: add `excerpt: z.string().optional()` to `PostDraftSchema`.
  **No length bounds in the Zod schema** — Gemini ignores min/max constraints and strict bounds
  reject valid output (the array-bounds trap); clamp downstream instead. Optional field =
  wire-compatible with mobile on-device drafts.
- Every runner prompt asks for a one-sentence excerpt; every call site passes `output.excerpt`
  to `toGeminiOutput`, which clamps to 200 chars (one rule everywhere, matching the fallback).
- **One central fallback** in `apps/worker/src/pipeline/post-writer.ts`:
  `excerpt || firstSentence(content, ≤200 chars)` (markdown/`IMAGE_N`-placeholder stripped).
  Covers client (on-device) drafts and manual stubs too — no newly created post is ever
  excerpt-null. The SIGHT path's now-redundant local fallback in `gemini-runner.ts:526-534` is
  removed.
- Backfill script `apps/worker/src/scripts/backfill-excerpts.ts` (conventions from
  `backfill-cover-images.ts`: `--dry-run`, `--user`): for posts with null/empty excerpt, derive
  the same first-sentence excerpt from `content`. The weighted `searchVector` trigger fires
  `ON UPDATE OF excerpt` (migration `20260624130000_weighted_search_vector`), so backfilled
  posts re-rank without extra work. Posts with an existing non-empty excerpt (e.g. manually
  edited) are never touched.
- Mobile on-device drafting prompts (`curate.ts`) for note/URL kinds are NOT updated this round
  (drafting is parked per `docs/llm/LLM-SOURCE-OF-TRUTH.md`); the central fallback covers their
  output regardless.

## Fix 3 — Chat `getPost` returns original notes, owner-gated

`apps/web/lib/chat/agent.ts` (getPost tool):

- After `findPostBySlug`, **only when `post.submittedById === viewerId`**, load the post's
  source submissions (`listSourceSubmissionsForPost`) → `rawNotesFor(payload)`
  (`apps/web/lib/originals/original-content.ts`) → append an
  `"Author's original submission notes"` section to the tool result.
- **Privacy invariant:** posts not owned by the viewer return exactly what they do today. The
  chat corpus includes friends' shared posts via `searchCorpus`; their notes must never appear
  in anyone else's chat context.
- One line added to the chat agent system prompt: the user's own posts may include their
  original submission notes; treat them as the author's verbatim intent.

## Validation (execute, don't scaffold)

1. `turbo check-types` + `turbo lint` with `--force` (stale remote-cache false-pass trap).
2. **Live pipeline run:** submit an image + a pointed note through the dev stack; verify the
   generated post incorporates the note's substance AND has a non-null excerpt; confirm
   `prompt:built` logs the new structure (`notesApplied: true`).
3. Also run one URL and one note submission to confirm excerpt lands for non-SIGHT types.
4. Backfill: `--dry-run` first, then real run against local dev DB; spot-check rows via
   `db:studio` or SQL.
5. Chat: ask the live chat about a note-bearing owned post → note content surfaces; verify a
   friend-owned post's getPost result carries no notes section.
6. Adversarial workflow review of the full diff before completion.

## Out of scope — recorded follow-ups (surfaced by the investigation)

- **Web composer never attaches notes to images** (`apps/web/app/(app)/ingest/omni-classify.ts`
  `toMaterial` omits `notes` for file kinds): image + typed text on web becomes TWO submissions
  (SIGHT with no note + separate note→BLOG). `submitImageBatch` already forwards a notes field —
  wiring the UI is a contained follow-up.
- **Raw-API per-image divergent notes drop:** worker `buildInput` reads `rows[0].payload.notes`
  only; a bearer-token client sending different notes per image loses all but index 0. First-party
  clients pre-join, so impact is API-only.
- **On-device draft bypass:** with `EXPO_PUBLIC_ON_DEVICE_AI` on, a valid client SIGHT draft
  skips Gemini; the note then only influenced the local llama draft (it still passes the server
  safety scan). Off by default today.
- **Notes in embeddings/retrieval** (semantic search matching note-only wording) — declined this
  round; would need `classification/prep.ts` change + re-embed backfill.
- **MCP corpus server + parked on-device ask flow** don't see notes either — candidates for the
  same owner-gated treatment later.
- **AI-written excerpt backfill** — declined in favor of deterministic first-sentence.
