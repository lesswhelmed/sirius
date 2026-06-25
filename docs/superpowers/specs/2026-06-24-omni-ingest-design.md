# Omni-Ingest Composer — UX & Classification Design (Stage 1 Contract)

**Date:** 2026-06-24
**Branch:** `feat/omni-ingest`
**Author:** Stage 1 UX Architect subagent (squad orchestrator: VioletPeak)
**Status:** Contract — downstream stages build against this; do not deviate without amending here.

This is a **design document only**. No production code is written here. Stage 2 (classifier package) and Stage 3a/3b (web/mobile UI) implement against the contracts below.

---

## 0. Scope, Boundaries, and What Is NOT Changing

We are replacing the **front-of-funnel capture/stage UX** of the ingest composer. Everything downstream of "tray → submit" is untouched.

### Hard boundaries (re-stated from the brief, anchored to real code)

1. **Submission kinds are a fixed enum of 6.** `IngestKind = "url" | "image" | "note" | "video" | "audio" | "document"` — defined in [`packages/db/src/ingest.ts`](../../../packages/db/src/ingest.ts) (lines 8–14). Every classified tray item MUST map onto exactly one of these 6 kinds at submit time. "Repository" is **not** a 7th kind — it is `kind=url` with GitHub detection (the existing `RepoMaterial` in [`materials.ts`](<../../../apps/web/app/(app)/ingest/materials.ts>) is a UI/preview convenience that already submits via `submitUrl` — see `submitMaterials` lines 468–473).

2. **Client classification is UX + pre-submit validation ONLY.** It is never the routing decision. The worker ([`apps/worker/src/pipeline/gemini-runner.ts`](../../../apps/worker/src/pipeline/gemini-runner.ts)) does authoritative platform routing and **forces** the final `PostType` (FINDING / SIGHT / BLOG) server-side. The client's "platform sub-label" (GitHub / Instagram / X / YouTube / Link) is a cosmetic badge + a hint to the user; the worker re-detects host independently and does not trust the client.

3. **Reuse the existing seam.** [`materials.ts`](<../../../apps/web/app/(app)/ingest/materials.ts>) already has `classifyUrl()` (Instagram / X / other / invalid, lines 158–183) and `urlMaterialsFromText()` (splits a blob into deduped `UrlMaterial[]`, lines 192–216). Stage 2 **extends/migrates** these into the shared package — it does NOT write a parallel classifier.

4. **DRY via a pure shared package.** Follow the precedent of [`@repo/embedding-scene`](../../../packages/embedding-scene/) and [`@repo/ingest-draft`](../../../packages/ingest-draft/): a `private` workspace package, pure functions, no host/DOM/React-Native imports in the core, consumed identically by web and mobile. Stage 2's classifier package (proposed name **`@repo/ingest-classify`**) mirrors `@repo/ingest-draft`'s `package.json` exactly (one `"."` export, `zod` as the only runtime dep, shared eslint/tsconfig).

5. **Submit pipeline is frozen.** Web composer → [`apps/web/lib/ingest/submit.ts`](../../../apps/web/lib/ingest/submit.ts) → `@repo/db` `createSubmission`. The endpoints (`/api/app/ingest`, `/api/app/ingest-images`, `/api/app/ingest-file`), the request schemas in [`apps/web/lib/ingest/schema.ts`](../../../apps/web/lib/ingest/schema.ts), `submit.ts`, the worker, and the DB schema are **NOT** modified by this redesign. The `submitMaterials()` dispatcher in `materials.ts` (lines 449–520) stays the submit target; only the **capture/staging UX that produces its `Material[]`** changes.

### What is NOT in scope (YAGNI)

- No new submission kind. No new endpoint. No DB migration.
- No change to `force`, `visibility`, or `projectId` mechanics (they remain compose-session-level settings, exactly as in `composer.tsx` lines 370–374).
- No new worker routing. No change to dedup hashing.
- No 7-card grid (it is **deleted**, replaced by the omni-dropzone).
- No per-card visibility (visibility stays one session-level choice applied to all items, matching today's behavior).

---

## 1. Step-by-Step User Journey (the frictionless flow)

The canonical scenario, exactly as the squad must support it: empty → mixed paste/drag → auto-classify → override → one validation failure → inline fix → submit. Each step lists **USER ACTION**, **SYSTEM RESPONSE**, **VISIBLE STATE**, and **A11Y (aria-live)**.

> Convention: aria-live region for the **tray** is `aria-live="polite"` (item add/remove/edit/classify). The **action/status** region (submit progress, post-submit outcome) is also `polite`. Validation errors that appear on a card use `role="alert"` (assertive) on the inline error node so a screen reader announces the blocking problem immediately. There is **no** global error banner.

### Step 1 — Empty state

- **USER ACTION:** Lands on the ingest screen. Does nothing yet.
- **SYSTEM RESPONSE:** Renders the OmniDropzone with primary copy. No tray. Action button present but disabled.
- **VISIBLE STATE:** Single dashed-bordered dropzone reading: **"Drop any link, file, or note here. We'll handle the sorting."** Below it (collapsed/absent) is the tray region. Bottom action button reads **"Add something to begin"**, disabled.
- **A11Y:** Dropzone is a labeled region (`aria-label="Omni input. Drop files, paste links, or type a note."`). The textbox affordance is focusable. Tray `aria-live` region is present but empty; on first render it announces nothing.

### Step 2 — User pastes ONE URL

- **USER ACTION:** Focuses the dropzone's text affordance, pastes `https://github.com/vercel/next.js`, commits (Enter or blur — see §2 commit rule).
- **SYSTEM RESPONSE:** Classifier runs: 1 token, matches URL matcher → `kind=url`, platform sub-label `Repository` (via `parseGitHubUrl`). One SmartCard is created in the tray. Input clears.
- **VISIBLE STATE:** Tray now shows 1 SmartCard: tag `[Link]` + platform pill `Repository`, content `https://github.com/vercel/next.js`, an override dropdown, a delete (✕). Action button enables → **"Process 1 Item"**.
- **A11Y:** Tray region announces **"Added 1 link. 1 item in tray."**

### Step 3 — User drags 3 photos + a PDF (one drop gesture)

- **USER ACTION:** Drags 4 files (`a.jpg`, `b.jpg`, `c.jpg`, `report.pdf`) onto the dropzone and releases.
- **SYSTEM RESPONSE:** Classifier inspects each `File` by MIME/extension: 3× `image/*` → `kind=image`; 1× `application/pdf` → `kind=document`. Four SmartCards appended. The 3 image cards are visually grouped/badged as a SIGHT batch (they will share a `batchId` at submit; see §2 submit-mapping), but each is an independent, individually-removable card.
- **VISIBLE STATE:** Tray now has 5 cards (1 url + 3 photo + 1 doc). Photo cards show a thumbnail + tag `[Photo]`; the doc card shows tag `[Document]` + filename `report.pdf`. Action button → **"Process 5 Items"**.
- **A11Y:** Tray announces **"Added 3 photos and 1 document. 5 items in tray."** (count of distinct adds summarized in one utterance, not 4 separate utterances — see §4 collapse rule applied to additions).

### Step 4 — Mixed paste: 2 URLs + a sentence of prose, in ONE paste

- **USER ACTION:** Pastes this single blob into the dropzone text affordance and commits:
  ```
  https://www.instagram.com/p/Cabc123/  https://example.com/article
  This reminded me of the kerning talk from last spring.
  ```
- **SYSTEM RESPONSE:** Text-splitting (§2): tokenize on whitespace + newlines. Two tokens pass the URL matcher → 2 `url` cards (one `Instagram` sub-label, one `Link` sub-label). The remaining run of non-URL words is reassembled, in original order, into **one** `note` card ("This reminded me of the kerning talk from last spring."). Net: **2 url cards + 1 note card** from one paste.
- **VISIBLE STATE:** Tray now has 8 cards. The 2 new url cards + 1 new note card appended. Action → **"Process 8 Items"**.
- **A11Y:** Tray announces **"Added 2 links and 1 note. 8 items in tray."**

### Step 5 — User overrides one mis-classified card

- **USER ACTION:** A pasted string `notes.txt` was classified as a `url` candidate that failed validation (it is not a URL → it actually became a `note` per §2; but suppose instead the user pasted a bare `example.com` that classified as `note` because it lacked a scheme, and they meant it as a link). User opens that card's KindOverrideMenu and picks **Link**.
- **SYSTEM RESPONSE:** Override matrix (§2) permits `note → url`. The card's kind flips to `url`; the classifier re-validates the content as a URL. `example.com` (no scheme) fails URL validation → the card now carries a **critical** inline error (see Step 6). Override does not re-run auto-classification on other cards.
- **VISIBLE STATE:** That card's tag changes `[Note]` → `[Link]`; a rust-red inline error appears under it. Action button **disables** (a critical error is unresolved) → label stays "Process 8 Items" but greyed.
- **A11Y:** Card's `role="alert"` announces **"This doesn't look like a valid web address. Add https:// or fix the link."** Tray region announces **"1 item needs attention."**

### Step 6 — One item fails validation (broken URL) — and the user fixes it inline

- **USER ACTION:** User clicks the card's content (it becomes an inline editable field — focus moves into it), edits `example.com` → `https://example.com`, commits.
- **SYSTEM RESPONSE:** Re-validation passes. The critical error clears. Action button re-enables.
- **VISIBLE STATE:** Rust-red error removed; card border returns to the default fine/dashed neutral. Action button active → **"Process 8 Items"**.
- **A11Y:** Card announces **"Fixed. Valid link."** Tray region announces **"No items need attention. 8 items ready."** Focus returns to the card (not lost to document body) after commit.

### Step 7 — User presses the action

- **USER ACTION:** Clicks **"Process 8 Items"** (a.k.a. "Generate Print Layout" — see §5 for the label rule).
- **SYSTEM RESPONSE:** The tray's `Material[]` is handed to the **unchanged** `submitMaterials()` (web) / its mobile equivalent. URL cards each submit as their own single-URL submission; the 3 photo cards submit as one `batchId` image batch (SIGHT); the note + doc submit independently. Per-item outcome pills render (queued / deduped / retrying / error) exactly as today (`composer.tsx` `handleSubmit` lines 704–728).
- **VISIBLE STATE:** Button shows a spinner + "Processing…". On all-success the tray clears and `force`/`projectId` reset to defaults (mirrors current reset). On any per-item `error`, the tray is **retained** and the failed card surfaces its inline error.
- **A11Y:** Action region announces **"Processing 8 items…"** then **"7 queued, 1 deduped."** (or the failure summary). Mirrors the existing `role="log" aria-live="polite"` pill list.

---

## 2. Classification Logic Framework (the Stage 2 contract)

This is the precise decision order Stage 2 implements as the shared pure package (`@repo/ingest-classify`). It **subsumes and replaces** `classifyUrl()` + `urlMaterialsFromText()` from `materials.ts` (those move into the package; `materials.ts` re-exports from it during migration so `composer.tsx`/mobile keep compiling).

### 2.0 Public surface (proposed)

```ts
// @repo/ingest-classify  (pure; zod is the only runtime dep)

export type ClassifiedKind = "url" | "image" | "note" | "video" | "audio" | "document";
export type PlatformLabel = "repository" | "instagram" | "x" | "youtube" | "link"; // url only

export interface ClassifiedItem {
  kind: ClassifiedKind;
  platform?: PlatformLabel;        // present iff kind === "url"
  // exactly one of { url, text, file } is set, matching kind
  url?: string;
  text?: string;
  file?: { name: string; type: string; size: number }; // metadata only in the pure core; the host holds the real File/Blob by id
  errors: ClassifyError[];         // [] = clean
}

export interface ClassifyError {
  field: "url" | "file" | "note";
  code: string;                    // stable machine code (see §2.6)
  message: string;                 // exact copy (see §2.6)
  severity: "warn" | "critical";   // critical blocks submit; warn does not
}

// File inputs (already File objects from drop/picker). Host passes metadata.
export function classifyFile(meta: { name: string; type: string; size: number }): ClassifiedItem;

// A pasted/typed text blob → N items (URL cards + at most one trailing note card).
export function classifyText(raw: string): ClassifiedItem[];

// Re-validate a single item after a manual override or inline edit.
export function validateItem(item: ClassifiedItem): ClassifyError[];

// Override legality check (the matrix in §2.5).
export function canOverride(from: ClassifiedKind, to: ClassifiedKind): boolean;

// In-tray duplicate detection (§2.7).
export function dedupKey(item: ClassifiedItem): string;
```

> Note: the pure core takes **file metadata** (`name/type/size`), never the binary, so it stays host-agnostic (no DOM `File`, no RN asset type). The host (web/mobile) keeps the real `File`/`Blob`/RN asset keyed by the card's `uid` and only feeds metadata into the classifier. This mirrors how `@repo/embedding-scene` operates on plain data, not Three.js objects.

### 2.1 Input discrimination (top-level decision order)

A drop or paste event may carry **files AND text simultaneously** (e.g. dragging a file from a browser also yields its URL as text; a paste can carry both). Rule, in order:

1. **If the event carries one or more `File` objects** → route every file through **`classifyFile`** (§2.2). Files are authoritative; do not also parse the OS-provided text fallback for those files.
2. **If the event carries text only** (typed note, pasted string, or paste with no files) → route the text through **`classifyText`** (§2.3).
3. A single gesture can produce **both** sets of cards (files from path 1 + text cards from path 2) only when the text is genuinely distinct user content, not a duplicate of the dropped files' URLs. Pragmatic rule for Stage 3: if `dataTransfer.files.length > 0`, **ignore** `dataTransfer.getData("text")` (it's almost always the file's own name/URI and would double-add). Pure paste with no files → always parse text.

### 2.2 File → kind (by MIME, then extension fallback)

Decision (reuse `kindForMime` from [`schema.ts`](../../../apps/web/lib/ingest/schema.ts) lines 113–123, lifted into the package):

| Condition (MIME first; extension if MIME blank/`application/octet-stream`) | kind | notes |
|---|---|---|
| `image/*` | `image` | HEIC/HEIF accepted client-side; server transcodes to JPEG (`submit.ts` lines 325–347). |
| `video/*` | `video` | reference-only; bytes fed to Gemini, never served. |
| `audio/*` | `audio` | reference-only. |
| `application/pdf` | `document` | |
| `application/msword` (`.doc`) | `document` | |
| `…wordprocessingml.document` (`.docx`) | `document` | |
| anything else | **reject** | card created in an error state with `code: "file_unsupported"`, severity **critical**. |

Extension fallback (when MIME is empty/`octet-stream`, common from RN share sheet and some drops): map `.jpg/.jpeg/.png/.webp/.heic/.heif/.gif → image`; `.mp4/.mov/.m4v → video`; `.mp3/.m4a/.wav/.aac → audio`; `.pdf/.doc/.docx → document`. (These mirror `FILE_TYPE_TO_EXT`/`TYPE_TO_EXT` in `schema.ts`.) Still no match → `file_unsupported` critical.

### 2.3 Text → URL(s) and/or note

`classifyText(raw)`:

1. **Tokenize** `raw` on the delimiter set: any run of whitespace **including newlines** (`/\s+/`) — this is a **superset** of the old `urlMaterialsFromText` delimiter (`/[\n\r,\s]+/`, line 201). We keep comma as a delimiter too for parity (`/[\s,]+/`).
2. For each token, test against the **URL matcher** (§2.4).
   - **URL token** → emit a `url` `ClassifiedItem` with a `platform` sub-label (§2.4).
   - **Non-URL token** → collect into a "prose run".
3. **Prose reassembly:** all non-URL tokens are re-joined **in original order** with single spaces into the **note text**. If, after trimming, the note text is non-empty → emit **exactly one** `note` `ClassifiedItem` carrying that text. (Multiple separate prose runs across the blob still collapse into ONE note card — we do not create a note per prose fragment.)
4. **De-dup within this paste:** identical URL strings (after normalization, §2.7) collapse to one card; surplus copies are dropped silently and surfaced as a tray-level "N duplicate links skipped" affordance (parity with today's `deduped` pill).
5. **Cap:** at most `MAX_URLS_PER_BATCH` (200, `materials.ts` line 187) url cards per single paste; overflow is dropped and surfaced as a "N over the 200 cap" affordance.

**Worked example (Step 4):** input `"https://www.instagram.com/p/Cabc123/  https://example.com/article\nThis reminded me of the kerning talk from last spring."` → tokens: `[ig-url, example-url, "This","reminded",…,"spring."]` → 2 url cards (`instagram`, `link`) + prose run `"This reminded me of the kerning talk from last spring."` → 1 note card. **Result: 2 url + 1 note.** ✅

### 2.4 URL matcher + platform sub-label

A token is a URL iff `new URL(token)` succeeds AND `protocol ∈ {http:, https:}`. (Stricter than the old `^https?:\/\//i` regex test on line 179; using the WHATWG `URL` parser is more correct and is already what `parseGitHubUrl`/`parseYouTubeUrl` use.) Bare-domain tokens with no scheme (`example.com`) are **NOT** URLs here → they fall into the prose/note run. (A user who meant a link without a scheme can override the note→url and will get a "add https://" critical error to fix — exactly Steps 5–6.)

Platform sub-label, in priority order (each reuses an existing pure parser; **migrate, do not duplicate**):

1. `parseGitHubUrl(token)` (from [`@repo/github-ingest`](../../../packages/github-ingest/src/url.ts)) non-null → `repository`.
2. `parseYouTubeUrl(token)` (from [`apps/worker/src/lib/youtube-url.ts`](../../../apps/worker/src/lib/youtube-url.ts) — Stage 2 lifts this into the shared package or re-exports it) non-null → `youtube`.
3. `INSTAGRAM_URL_REGEX` (materials.ts line 158) → `instagram`.
4. `X_URL_REGEX` (materials.ts line 163) → `x`.
5. else → `link`.

**Sub-label is cosmetic.** The worker re-detects host independently and is the only routing authority (boundary #2). The classifier never sets `PostType`.

### 2.5 URL-splitting — the explicit behavior change

**OLD flow:** the link sheet accepted a newline/whitespace-delimited blob and `urlMaterialsFromText` produced `UrlMaterial[]`, but they were staged as a list the user saw as one "Preview (N URLs)" block; multi-URL *submission semantics* already split per-URL inside `submitMaterials` (each url → its own `submitUrl` call, `materials.ts` lines 458–464; comment lines 266–268 explains why: per-URL submission lets the worker's IG/YT dedicated paths fire). The user, however, edited them as a single text blob.

**NEW flow:** the multi-URL paste is **auto-split into ONE TRAY CARD PER URL at paste time, before submit.** Each url card classifies, validates, and is edited/removed **independently** in the tray. The note prose from the same paste becomes its **own** note card.

Precise rules:
- **Delimiter:** any whitespace run (incl. newline) OR comma (`/[\s,]+/`).
- **Trailing/interleaved prose:** every non-URL token, reassembled in order, becomes a single `note` card (§2.3 step 3).
- **Submit mapping (so `submit.ts` / the API contract stay UNCHANGED):** at submit, each url card maps to a **distinct submission** — `submitUrl` is called once per url card with `urls: [card.url]` (exactly the existing per-URL fan-out in `submitMaterials`, `materials.ts` lines 269–303 + 458–464). We do **NOT** reconstruct a single `urls: string[]` array. Rationale, verbatim from the existing code comment (lines 266–268): *"One URL becomes its own submission so the worker's dedicated IG / YT paths fire per-URL. A single submission with N urls gets routed to the generic url_context summarizer and collapses everything into one post."* So the new tray is just making the *already-correct* per-URL submission semantics **visible and independently editable** in the UI. **The shape `submitMaterials` receives (`Material[]`) and the endpoints it calls are identical to today.**

### 2.6 Validation rules per kind + inline error shape

`ClassifyError = { field, code, message, severity }`. `severity:"critical"` blocks submit (action button disabled while any tray card has a critical error); `severity:"warn"` does not block (the user may submit anyway).

| kind | rule | code | severity | exact message copy |
|---|---|---|---|---|
| url | token does not parse as `http(s)` URL (e.g. after a `note→url` override of `example.com`) | `url_invalid` | **critical** | "This doesn't look like a valid web address. Add https:// or fix the link." |
| url | parses but host is empty / `localhost` / IP-only | `url_suspicious` | warn | "We can't always read links like this — submit anyway if you're sure." |
| note | empty after trim | `note_empty` | **critical** | "Write something first." |
| image / video / audio / document | MIME+ext not in the allowed set (§2.2) | `file_unsupported` | **critical** | "We can't read this file type. Supported: images, video, audio, PDF, or Word docs." |
| image / video / audio / document | size exceeds the client soft-cap (see below) | `file_too_large` | **critical** | "This file is over the {LIMIT} limit. Try a smaller file." |
| any | in-tray duplicate detected (§2.7) | `duplicate` | warn | "Looks like a duplicate of another item — remove it or submit both." |

**File size soft-cap.** The server defines **no** explicit byte limit today (confirmed: no `MAX_SIZE`/413 guard in `apps/web`/`packages`; only `next.config` body limits apply at the platform layer). Stage 2 therefore introduces a **client-side advisory cap** as a single exported constant in the package (proposed `MAX_FILE_BYTES`, default **50 MB** for images/docs, **200 MB** for video/audio — Stage 3 may tune; the constant is the single source of truth). This is **client-only UX guidance** (the brief: classification is a UX affordance + pre-submit validation). `{LIMIT}` in the copy renders the human-readable cap. **Open question O-1** (see §7) flags that we should confirm the desired caps with the human rather than guess.

The inline error renders **on the specific card** (rust-red `~#B5523A`, fine left-border accent), never as a stacked global banner.

### 2.7 In-tray duplicate affordance (client pre-flight; server dedup unchanged)

Server-side `contentHash` dedup is authoritative and unchanged (`createSubmission` `P2002` path, `ingest.ts` lines 69–124). The client adds a **pre-submit, in-tray** duplicate *hint* only (severity `warn`, never blocks):

- **`dedupKey` for a `url` card:** the normalized URL string = lowercase host + path, drop trailing slash, drop a leading `www.`, strip a trailing `.git` (so `github.com/o/r` and `github.com/o/r.git` collide), preserve query for IG/YT IDs. (Use the canonical URL when the platform parser provides one — `parseGitHubUrl().canonicalUrl`, `parseYouTubeUrl().canonicalUrl`.)
- **`dedupKey` for a `file` card (image/video/audio/document):** `name + ":" + size` (filename + byte size). This is the "obvious duplicate" definition — same filename and same size.
- **`dedupKey` for a `note` card:** trimmed, whitespace-collapsed text. (Two identical pasted notes flag.)

When two tray cards share a `dedupKey`, the **second+** card carries the `duplicate` warn error. The user may delete or submit anyway (the server will dedup or retry-on-failure regardless).

### 2.8 Override matrix (explicit table)

Rows = detected kind; columns = the target kind the user may switch a card to via KindOverrideMenu. `YES` = allowed; `NO` = illegal (menu hides/disables it). `self` = the card's own kind (no-op).

| from \ to    | url | note | image | video | audio | document |
|--------------|-----|------|-------|-------|-------|----------|
| **url**      | self | YES | NO  | NO  | NO  | NO  |
| **note**     | YES | self | NO  | NO  | NO  | NO  |
| **image**    | NO  | NO  | self | YES | YES | YES |
| **video**    | NO  | NO  | YES | self | YES | YES |
| **audio**    | NO  | NO  | YES | YES | self | YES |
| **document** | NO  | NO  | YES | YES | YES | self |

Legend / rationale (the *only* legal transitions and why):

- **Text-backed cards (`url` ⇄ `note`)** may swap freely: both are text content, no binary backing. This is the common correction (a bare domain meant as a link, or a URL the user wants treated as prose). After `note→url`, re-validate (a non-URL gets `url_invalid` critical — Steps 5–6).
- **File-backed cards may re-target only among the file kinds** the same bytes can plausibly be (`image ↔ video ↔ audio ↔ document`). This covers the MIME-blank case where a `.mov` arrived as `octet-stream` and got mis-binned; the user fixes the kind without re-uploading. The submit endpoint for files (`/api/app/ingest-file`) takes a `kind` field already (`schema.ts` `fileMetadataSchema`), so the override just changes which kind string is sent (images still go to `/api/app/ingest-images`).
- **A file-backed card may NEVER become `note` or `url`** — you cannot turn a JPEG into prose or a web address; there is no text to put there. **Explicitly illegal (the whole `NO` block):** `image→note`, `image→url`, `video→note`, `video→url`, and likewise `audio`/`document` → `url`/`note`. The brief's example ("a jpg can't become kind=note") is the `image→note = NO` cell.
- **`audio`/`document` → `url`/`note` are illegal in v1.** We do NOT extract text from a PDF/audio on the client; the worker does understanding. Keeping them illegal avoids a card that claims to be a note but has no text. *(A future "transcribe doc to note" could relax these — out of scope now, YAGNI.)*

> **Stage 2 implements `canOverride(from,to)` to return `true` ONLY for the `YES`/`self` cells: `url⇄note` (incl. self), and any file-kind → any file-kind (incl. self). Every other pair returns `false`.**

---

## 3. Wireframe Outline (3 states × {wide, narrow})

Shared vertical stack in all states: **[OmniDropzone] → [StagingTray] → [UnifiedActionButton]**, with the session-level controls (`Focus` chips, `Visibility` radiogroup, `Force` toggle — all retained from today, `composer.tsx` 766–1001) sitting between the tray and the action button. The dropzone is the only genuinely new region; the controls and action are restyled-but-functionally-identical.

**Identical across web & mobile (shared logic / shared component contract):**
- The three regions and their order; SmartCard anatomy (tag, platform pill, content, override menu, delete, inline error); classification + validation + override + dedup outcomes (all from `@repo/ingest-classify`); the action label rule; error-collapse rule; aria-live semantics (RN uses `accessibilityLiveRegion`/`AccessibilityInfo.announceForAccessibility`).

**Host-specific (the thin host layer):**
- **Web:** HTML5 drag-and-drop (`onDrop`/`dataTransfer`), clipboard paste into a contenteditable/textarea, hidden `<input type=file>` as a click-to-pick fallback inside the dropzone, `<select>`/menu for override.
- **Mobile:** no drag-drop. The dropzone surfaces **tap targets**: a text field for typing/pasting a note or URL, a **camera** button, a **photo/library** picker, a **files** picker, and **share-sheet ingestion** (the existing `materialsFromShareIntent` path in `apps/mobile/src/lib/materials.ts` feeds the same classifier). Override is an ActionSheet/Menu.

### 3a. EMPTY STATE

**Wide (desktop):**
```
┌──────────────────────────────────────────────────────────────┐
│  Add to your corpus                              (serif H1)    │
│                                                                │
│  ╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮   │
│  ┊                         ⌖                              ┊   │  ← dashed
│  ┊     Drop any link, file, or note here.                ┊   │
│  ┊     We'll handle the sorting.                          ┊   │
│  ┊     [ type or paste …            ]   [ browse files ]  ┊   │
│  ╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯   │
│                                                                │
│  Focus:  ( None ) ( Project A ) ( Project B )                 │
│  Visibility:  [Private]  [Friends]  [Public]                  │
│  ☐ Force · bypass dedup                                       │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Add something to begin   (disabled)       │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**Narrow (mobile):**
```
┌────────────────────────────┐
│ Add to your corpus          │
│ ╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮ │
│ ┊        ⌖                ┊ │
│ ┊ Drop any link, file, or ┊ │
│ ┊ note here. We'll handle ┊ │
│ ┊ the sorting.            ┊ │
│ ┊ [ type or paste …     ] ┊ │
│ ┊ [▦ Photos][⎙ Camera]   ┊ │  ← mobile: tap targets
│ ┊ [📄 Files]             ┊ │     (no drag-drop)
│ ╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯ │
│ Focus: (None)(A)(B)         │
│ Visibility:[Priv][Fr][Pub]  │
│ ☐ Force                     │
│ ┌────────────────────────┐ │
│ │ Add something (disabled)│ │
│ └────────────────────────┘ │
└────────────────────────────┘
```

### 3b. POPULATED TRAY STATE (clean — Step 4 result, 8 items abbreviated)

**Wide:**
```
┌──────────────────────────────────────────────────────────────┐
│  ╭┄ dropzone (compact; still accepts more) ┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮   │
│  ┊ Drop more, or type a note…   [ … ]   [ browse ]      ┊   │
│  ╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯   │
│  In tray                                            8 items   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ [Link] (Repository)  github.com/vercel/next.js   ⌄  ✕ │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │ [▦Photo] a.jpg                                   ⌄  ✕ │    │
│  │ [▦Photo] b.jpg                                   ⌄  ✕ │    │  ← 3 photos
│  │ [▦Photo] c.jpg            (grouped: 1 SIGHT)     ⌄  ✕ │    │     badged as
│  ├──────────────────────────────────────────────────────┤    │     one batch
│  │ [Document] report.pdf                            ⌄  ✕ │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │ [Link] (Instagram)  instagram.com/p/Cabc123      ⌄  ✕ │    │
│  │ [Link] (Link)       example.com/article          ⌄  ✕ │    │
│  │ [Note]  This reminded me of the kerning talk…    ⌄  ✕ │    │
│  └──────────────────────────────────────────────────────┘    │
│  Focus/Visibility/Force …                                     │
│  ┌──────────────────────────────────────────────────────┐    │
│  │            Process 8 Items            →   (active)      │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```
`⌄` = KindOverrideMenu; `✕` = delete. Override `⌄` is hidden/disabled on a card only when the matrix offers no legal target other than self.

**Narrow:** same stack, one card per row full-width, override + delete as a trailing row of two icon buttons; photo thumbnails 40×40 leading. Dropzone collapses to a one-line "Drop more / type a note" + the three mobile tap targets behind a "+" disclosure.

### 3c. ERROR STATE (Step 5/6 — one critical url error + a collapsed file error demo)

**Wide:**
```
┌──────────────────────────────────────────────────────────────┐
│  ╭┄ dropzone ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮   │
│  ╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯   │
│  In tray                                  8 items · 1 to fix  │
│                                                                │
│  ▎ 3 files exceeded the 50 MB limit.  (tray-level summary)    │  ← only when
│    (rust-red, ONE line; affected cards get a subtle ▎ marker) │     ≥3 share a
│                                                                │     code (§4)
│  ┌──────────────────────────────────────────────────────┐    │
│  │ [Link] (Link)  example.com                       ⌄  ✕ │    │
│  │ ▎ This doesn't look like a valid web address.         │    │  ← per-card,
│  │   Add https:// or fix the link.   [ edit ]            │    │     role=alert
│  └──────────────────────────────────────────────────────┘    │
│  … (other cards) …                                            │
│  ┌──────────────────────────────────────────────────────┐    │
│  │            Process 8 Items            (DISABLED)        │    │  ← critical
│  └──────────────────────────────────────────────────────┘    │     blocks
└──────────────────────────────────────────────────────────────┘
```

**Narrow:** identical semantics; the per-card error wraps under the card content; the tray-level collapsed summary sits directly under the "In tray" header. Rust-red `~#B5523A` is used **only** here.

---

## 4. Error Consolidation Rules

Goal: never stack N identical errors. Per-card detail when sparse; one tray-level summary when dense.

- **Per-card by default.** Every card with an error shows its own inline `ClassifyError.message` (rust-red, `role="alert"`).
- **Collapse threshold = 3.** When **≥ 3** tray cards share the **same `ClassifyError.code`** (e.g. 3+ `file_too_large`, or 3+ `file_unsupported`), the individual full messages are **replaced** by:
  - **One tray-level summary line** at the top of the tray: `"{N} files exceeded the {LIMIT} limit."` / `"{N} files aren't a supported type."` / `"{N} duplicate links skipped."` (warn-toned for `duplicate`, rust for critical codes).
  - **A subtle per-card marker** (a thin rust ▎ left-border + the short code label, e.g. `too large`) on each affected card — enough to locate them, without repeating the full sentence N times.
- **Mixed codes do not merge.** Collapse is per-`code`. If 3 cards are `file_too_large` and 2 are `url_invalid`, you get one collapsed summary for the size errors plus 2 normal per-card `url_invalid` messages (each below threshold).
- **Additions are summarized too (Steps 2–4).** When one gesture adds ≥ 2 cards, the aria-live announcement summarizes counts per kind in ONE utterance ("Added 3 photos and 1 document"), never one utterance per card.
- **Submit gating:** the action button is disabled iff **any** tray card carries a `severity:"critical"` error (collapsed or not). `warn` never blocks. Empty tray also disables (label "Add something to begin").
- **The tray-level summary is the ONLY tray-wide error text.** It is not a "global banner" in the prohibited sense (it is contextual to the tray, dismisses automatically when the underlying cards are fixed/removed, and coexists with the per-card markers). There is no app-level/page-level error banner.

---

## 5. Component Inventory (shared contract for Stage 3a web + 3b mobile)

Each component is named, with **what it does**, **props/inputs**, and **depends on**. Web and mobile implement the **same prop contract**; only the rendering primitives differ (DOM vs RN). Logic lives in `@repo/ingest-classify`; components are thin.

### `OmniDropzone`
- **Does:** The single top region. Accepts text (type/paste) and files. On commit, calls the classifier and emits new items upward. Hosts the empty-state copy and (web) drag-over visual; (mobile) the camera/library/files tap targets.
- **Props:** `onItemsClassified(items: ClassifiedItem[], files?: HostFileHandle[])`, `disabled: boolean` (during submit), `compact: boolean` (collapses once tray is non-empty), `copy: { idle: string }` (default "Drop any link, file, or note here. We'll handle the sorting.").
- **Depends on:** `classifyText`, `classifyFile` (from `@repo/ingest-classify`); host file/drag/paste APIs; host file-handle registry (keeps real `File`/RN asset keyed by `uid`).

### `StagingTray`
- **Does:** The middle region. Renders the list of `SmartCard`s, the tray header (count + "N to fix"), the `TrayErrorSummary` (when collapse fires), and owns the tray-level `aria-live` announcements.
- **Props:** `items: TrayItem[]` (`TrayItem = { uid; classified: ClassifiedItem }`), `onEdit(uid, patch)`, `onOverride(uid, toKind)`, `onRemove(uid)`, `disabled`.
- **Depends on:** `SmartCard`, `TrayErrorSummary`; pure `validateItem`, `canOverride`, `dedupKey` for derived state.

### `SmartCard`
- **Does:** One staged item. Shows kind tag (`[Link]`/`[Photo]`/`[Document]`/…), platform pill (url only), content (read view + inline-editable for `url`/`note`; thumbnail/filename for files), `KindOverrideMenu`, delete, and `InlineCardError`. Manages focus on enter/exit of inline edit (focus returns to the card after commit — Step 6).
- **Props:** `item: TrayItem`, `onEdit(uid, { text } | { url })`, `onOverride(uid, toKind)`, `onRemove(uid)`, `disabled`, `thumbUrl?` (image preview object-URL, host-provided & host-revoked).
- **Depends on:** `KindOverrideMenu`, `InlineCardError`; `validateItem` (re-validate on edit/override).

### `KindOverrideMenu`
- **Does:** The subtle dropdown to manually re-tag a card. Lists only the legal target kinds for the card's current kind.
- **Props:** `fromKind: ClassifiedKind`, `onSelect(toKind: ClassifiedKind)`, `disabled`.
- **Depends on:** `canOverride(from, to)` (the matrix, §2.8) to compute the offered options. If the only legal target is self, the menu is hidden.

### `InlineCardError`
- **Does:** Renders one card's error(s) inline (rust-red `~#B5523A`, fine left accent), `role="alert"`. When the tray-level collapse is active for this card's code, it renders the **subtle marker** form instead of the full sentence (§4).
- **Props:** `errors: ClassifyError[]`, `collapsed: boolean` (true → marker form), `onEditRequest?()` (focus the content for fixing).
- **Depends on:** nothing beyond the error objects.

### `TrayErrorSummary`
- **Does:** The single tray-level collapsed line when ≥3 cards share a code (§4). Not a global banner.
- **Props:** `summaries: { code: string; count: number; message: string; severity }[]`.
- **Depends on:** consolidation derivation in `StagingTray` (pure helper, can live in the package as `consolidateErrors(items)`).

### `UnifiedActionButton`
- **Does:** The single bottom action. Disabled when tray empty OR any critical error. Label rule: empty → **"Add something to begin"**; ready → **"Process {N} Item{s}"** as the default; the secondary phrasing **"Generate Print Layout"** is acceptable as the active-state label per the brief — Stage 3 picks ONE and uses it consistently (see Open Question O-2). Shows spinner + "Processing…" during submit.
- **Props:** `count: number`, `disabled: boolean`, `pending: boolean`, `onPress()`.
- **Depends on:** the host's submit handler, which calls the **unchanged** `submitMaterials()` (web) / mobile equivalent with the tray's `Material[]`.

> **Material mapping at submit (the bridge to the frozen pipeline):** a small pure adapter `toMaterials(items, fileRegistry): Material[]` converts `ClassifiedItem[]` → the existing `Material[]` union from `materials.ts` (url/repo→`UrlMaterial`/`RepoMaterial`, note→`NoteMaterial`, image→`ImageMaterial`, video/audio/document→their materials, pulling the real `File` from the host registry by `uid`). This is the ONLY new submit-adjacent code, and it produces exactly the shape `submitMaterials` already consumes — so `submit.ts`, the endpoints, the worker, and the DB are untouched.

---

## 6. Accessibility Contract (cross-cutting)

- **Keyboard:** dropzone text affordance is focusable and accepts paste; a visible "browse files" control gives a non-drag path (web). Every card's edit/override/delete is keyboard reachable. Inline edit commits on Enter/blur and **returns focus to the card** (Step 6), never drops focus to `<body>`.
- **aria-live regions:** one `polite` region for the tray (adds/removes/edits/classification/"N to fix"); inline card errors are `role="alert"` (assertive). The submit/outcome pill log keeps today's `role="log" aria-live="polite"` (`composer.tsx` 736). Mobile uses `accessibilityLiveRegion="polite"` on the tray container + `AccessibilityInfo.announceForAccessibility(...)` for add/override/error transitions.
- **Announcements are summarized** (one utterance per gesture, §4), never N-per-card.
- **Color is never the sole signal:** rust-red errors always pair with text + an icon/marker (WCAG 1.4.1).

---

## 7. Open Questions for the Human (verbatim)

- **O-1 (file size caps):** The server enforces **no** explicit byte limit today (no `MAX_SIZE`/413 guard exists in `apps/web`/`packages`). I propose a *client-side advisory* cap as a single package constant (default 50 MB images/docs, 200 MB video/audio) purely so the UI can warn early. **Please confirm the exact caps you want, or confirm "no client cap, let the platform/server reject"** — I don't want to invent a limit that silently blocks legitimate large uploads.
- **O-2 (primary button label):** The brief gives two phrasings — **"Process {N} Items"** and **"Generate Print Layout."** I lean toward "Process {N} Items" (it states the count and the action) and reserve "Generate Print Layout" only if you want the print-output framing front-and-center. **Which single label should Stage 3 ship?** (I want one consistent string, not both.)
- **O-3 (bare-domain tokens):** I classify a no-scheme token like `example.com` as **note** (not URL), so the user must override→Link and add `https://`. The alternative is auto-prepending `https://` and treating bare domains as links. Auto-prepend is friendlier but can mis-link prose that happens to contain a word with a dot (`e.g.`, `node.js`). **Confirm you want the conservative behavior (bare domain = note, explicit override to link)**, or accept the auto-prepend risk.
- **O-4 (SIGHT batch grouping in the tray):** 3 dropped photos become 3 independent SmartCards but submit as one `batchId` SIGHT post. I show them visually grouped/badged "1 SIGHT". **Is the per-photo card (each individually removable) the right granularity, or do you want a single collapsed "Photo batch (3)" card** that expands? (Per-photo is more editable; a single card is tidier.)
- **O-5 (override of a file kind that changes the submit endpoint):** Overriding `image→video` moves the card from the `/api/app/ingest-images` batch path to the `/api/app/ingest-file` path. That's supported by the existing endpoints, but it means a photo the user re-tags as "video" gets fed to Gemini as video bytes (reference-only, never served). **Confirm this cross-endpoint override is desirable**, or restrict file overrides to same-endpoint kinds only (i.e. image stays image; video⇄audio⇄document interchange only).
