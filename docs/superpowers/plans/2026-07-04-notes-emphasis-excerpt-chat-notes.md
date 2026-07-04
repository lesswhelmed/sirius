# Notes Emphasis + Excerpt Everywhere + Chat Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user capture-notes actually steer AI-drafted posts, give every post type an excerpt (with backfill), and let the chat agent read the owner's original submission notes.

**Architecture:** All drafting flows through `apps/worker/src/pipeline/gemini-runner.ts` (+ dedicated runners) into `toGeminiOutput` → `post-writer.ts`. We (1) move the author-note block from a trailing suffix to a primary lead block via one shared helper, (2) add optional `excerpt` to the shared `PostDraftSchema` and read it centrally in `toGeminiOutput` with a first-sentence fallback in `post-writer.ts`, (3) append an owner-gated notes trailer to the chat agent's `get_post` tool result.

**Tech Stack:** Bun, TypeScript ~6.0.3, Zod 4, Prisma 7, Vercel AI SDK (`ai` + `@ai-sdk/google`), bun:test.

**Spec:** `docs/superpowers/specs/2026-07-04-notes-emphasis-excerpt-chat-notes-design.md`

## Global Constraints

- Package manager is **bun**; run commands from repo root unless noted. Worker tests: `bun test <path>` (bun:test is wired; there is NO repo-wide test runner script).
- Prisma client must be generated before typechecking: `bun run db:generate` once per fresh session.
- **NO `.min()`/`.max()`/length bounds on new Zod schema fields** — Gemini ignores JSON-schema bounds and a strict bound fails the whole post. Steer via `.describe()`, clamp in `toGeminiOutput`.
- Excerpt clamp length is **200 chars** everywhere (model output clamp AND fallback).
- **Privacy invariant (chat):** submission notes may only ever be appended for posts where `post.submittedById === viewerId`. Friends' posts must return exactly what they do today.
- **Instagram runner is deliberately untouched** — its body is a deterministic templated extraction (not voiced prose); its excerpt comes from the central post-writer fallback.
- The BLOG (note-kind) prompt keeps notes as the prompt body — do not add a lead block there.
- Do not touch `packages/ingest-draft` `SightDraftSchema`'s existing excerpt field or the mobile `curate.ts` prompts (on-device drafting is parked).
- **Swarm commit rule:** this repo runs a multi-agent swarm on a shared tree. Commit ONLY explicit paths: `git add <paths> && git commit -m "..." -- <paths>`. NEVER `git add -A` or bare `git commit -a`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Typecheck/lint verification must use `--force` (stale turbo remote-cache can false-pass): `bunx turbo check-types lint --filter=worker --filter=web --filter=@repo/ingest-draft --filter=@repo/research-agent --force`.

---

### Task 1: `excerpt` on `PostDraftSchema` + central read/clamp in `toGeminiOutput`

**Files:**
- Modify: `packages/ingest-draft/src/index.ts` (PostDraftSchema, ~line 38 before `body`)
- Modify: `apps/worker/src/pipeline/gemini-runner.ts` (`toGeminiOutput` ~line 234; SIGHT call site ~lines 525-534)
- Test: `apps/worker/src/pipeline/gemini-runner.test.ts` (new file)

**Interfaces:**
- Produces: `PostDraft` type gains optional `excerpt?: string`. `toGeminiOutput(draft, forcedType, opts?)` now resolves excerpt as `opts?.excerpt ?? draft.excerpt`, trims, clamps to 200 chars, and sets `frontmatter.excerpt` only when non-empty. Every existing call site (github/twitter/youtube/document/draft-runner note+url) gets excerpt passthrough FOR FREE via `draft.excerpt` — no call-site edits needed for excerpt.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/pipeline/gemini-runner.test.ts`:

```ts
// Unit tests for toGeminiOutput's excerpt contract (draft.excerpt is read
// centrally so every runner gets passthrough without call-site changes) and,
// in Task 2, for the prompt builders' notes-lead ordering. Pure functions —
// no DB, no Gemini.
import { expect, test } from "bun:test";
import { toGeminiOutput } from "./gemini-runner";

const baseDraft = {
  title: "A Post",
  tags: ["one"],
  categories: ["life"],
  body: "First sentence here. Second sentence follows.",
};

test("toGeminiOutput reads draft.excerpt when opts.excerpt is absent", () => {
  const out = toGeminiOutput(
    { ...baseDraft, excerpt: "  A one-line summary.  " },
    "BLOG",
  );
  expect(out.frontmatter.excerpt).toBe("A one-line summary.");
});

test("toGeminiOutput lets opts.excerpt override draft.excerpt", () => {
  const out = toGeminiOutput(
    { ...baseDraft, excerpt: "from draft" },
    "SIGHT",
    { excerpt: "from opts" },
  );
  expect(out.frontmatter.excerpt).toBe("from opts");
});

test("toGeminiOutput clamps excerpt to 200 chars", () => {
  const out = toGeminiOutput(
    { ...baseDraft, excerpt: "x".repeat(500) },
    "BLOG",
  );
  expect((out.frontmatter.excerpt as string).length).toBe(200);
});

test("toGeminiOutput omits frontmatter.excerpt when none provided", () => {
  const out = toGeminiOutput(baseDraft, "BLOG");
  expect(out.frontmatter.excerpt).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/worker/src/pipeline/gemini-runner.test.ts`
Expected: FAIL — first test gets `undefined` (draft.excerpt is not read today; it is also a type error until the schema change lands, which is fine — the test run fails either way).

- [ ] **Step 3: Add `excerpt` to `PostDraftSchema`**

In `packages/ingest-draft/src/index.ts`, insert between the `categories` field and the `body` field of `PostDraftSchema` (after the categories `.describe(...)` closing, ~line 37):

```ts
  // Optional for the same reason the arrays carry no bounds: flash sometimes
  // omits described-optional fields, and a missing excerpt must not fail the
  // post — post-writer derives a first-sentence fallback instead.
  excerpt: z
    .string()
    .optional()
    .describe(
      "One plain declarative sentence summarizing the post. No hype, no ellipsis.",
    ),
```

- [ ] **Step 4: Read + clamp `draft.excerpt` in `toGeminiOutput`**

In `apps/worker/src/pipeline/gemini-runner.ts`, replace (currently ~lines 234-237):

```ts
  const excerpt = opts?.excerpt?.trim();
  if (excerpt) {
    frontmatter.excerpt = excerpt;
  }
```

with:

```ts
  // Excerpt: explicit opts win (client-draft SIGHT caller), else the draft's
  // own optional excerpt (on PostDraftSchema for every kind since 2026-07).
  // Clamped to 200 chars like the tag/category counts — steer in the prompt,
  // enforce here. Posts with no excerpt at all get a first-sentence fallback
  // in post-writer, so this stays absence-tolerant.
  const excerpt = (opts?.excerpt ?? draft.excerpt)?.trim().slice(0, 200);
  if (excerpt) {
    frontmatter.excerpt = excerpt;
  }
```

- [ ] **Step 5: Remove the SIGHT-local first-sentence fallback**

In `apps/worker/src/pipeline/gemini-runner.ts`, replace (currently ~lines 525-534):

```ts
    const { output } = draftResult;
    // excerpt is optional in the schema (flash sometimes omits it). Fall back to
    // the first sentence of the body so the post still has a summary line.
    const excerpt =
      output.excerpt?.trim() ||
      output.body.trim().split(/(?<=[.!?])\s+/)[0]?.slice(0, 200);
    const result = toGeminiOutput(output, "SIGHT", {
      excerpt,
      imageAlts: output.imageAlts,
    });
```

with:

```ts
    const { output } = draftResult;
    // output.excerpt (optional) is read by toGeminiOutput directly; a missing
    // one gets the central first-sentence fallback in post-writer.
    const result = toGeminiOutput(output, "SIGHT", {
      imageAlts: output.imageAlts,
    });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test apps/worker/src/pipeline/gemini-runner.test.ts`
Expected: 4 pass.
Also run the untouched suites that import these modules: `bun test apps/worker/src/pipeline/`
Expected: all pass (post-writer, github runner, safety, classification tests unaffected).

- [ ] **Step 7: Typecheck**

Run: `bunx turbo check-types --filter=worker --filter=@repo/ingest-draft --force`
Expected: PASS. (`draft-runner.ts` note/url paths now silently carry `excerpt` through the shared type — no edit needed there.)

- [ ] **Step 8: Commit**

```bash
git add packages/ingest-draft/src/index.ts apps/worker/src/pipeline/gemini-runner.ts apps/worker/src/pipeline/gemini-runner.test.ts
git commit -m "feat(worker): excerpt on PostDraftSchema, read+clamp centrally in toGeminiOutput

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- packages/ingest-draft/src/index.ts apps/worker/src/pipeline/gemini-runner.ts apps/worker/src/pipeline/gemini-runner.test.ts
```

---

### Task 2: Notes-lead prompt block + restructure `buildPrompt` / `buildUrlStructuringPrompt`

**Files:**
- Create: `apps/worker/src/pipeline/prompt-blocks.ts`
- Test: `apps/worker/src/pipeline/prompt-blocks.test.ts` (new)
- Modify: `apps/worker/src/pipeline/gemini-runner.ts` (`buildPrompt` lines ~73-133, `buildUrlStructuringPrompt` lines ~135-162 — both become exported)
- Test: `apps/worker/src/pipeline/gemini-runner.test.ts` (extend from Task 1)

**Interfaces:**
- Produces: `notesLeadLines(notes: string): string[]` — returns a 3-element block (`[headline, directive, ""]`) or `[]` when the note is empty. Task 3's runners import it from `../prompt-blocks`. `buildPrompt(input: PipelineInput, voiceBlock: string): string` and `buildUrlStructuringPrompt(summary: string, notes: string, voiceBlock: string): string` become `export function` (precedent: `buildGitHubPrompt` is exported for unit testing).
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing helper test**

Create `apps/worker/src/pipeline/prompt-blocks.test.ts`:

```ts
import { expect, test } from "bun:test";
import { notesLeadLines } from "./prompt-blocks";

test("notesLeadLines returns [] for empty/whitespace notes", () => {
  expect(notesLeadLines("")).toEqual([]);
  expect(notesLeadLines("   \n ")).toEqual([]);
});

test("notesLeadLines wraps the trimmed note as a primary steering block", () => {
  const lines = notesLeadLines("  this is the trail where the bridge broke  ");
  expect(lines[0]).toContain("«this is the trail where the bridge broke»");
  expect(lines[0]).toContain("AUTHOR'S NOTE");
  // The structure guard must survive the move from trailing to lead position.
  expect(lines[1]).toContain("must not change the output structure");
  expect(lines[lines.length - 1]).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/worker/src/pipeline/prompt-blocks.test.ts`
Expected: FAIL — "Cannot find module './prompt-blocks'".

- [ ] **Step 3: Create the helper**

Create `apps/worker/src/pipeline/prompt-blocks.ts`:

```ts
// Shared prompt fragments for the drafting runners. Lives in its own module
// (not gemini-runner) so the dedicated runners can import it without deepening
// the existing gemini-runner <-> runner import cycle.

// The author's capture note as a PRIMARY steering block, placed near the top of
// a drafting prompt (before the evidence/attachments) instead of trailing after
// the instructions — Flash-class models underweight trailing context, which
// made user notes feel ignored in generated posts. Returns [] when there is no
// note so callers can spread it unconditionally.
export function notesLeadLines(notes: string): string[] {
  const trimmed = notes.trim();
  if (!trimmed) {
    return [];
  }
  return [
    `AUTHOR'S NOTE — why they saved this (primary steering input): «${trimmed}»`,
    "The note is what the post is really about: let it drive the angle, emphasis, and what to include or leave out, and make sure the body reflects its substance (natural paraphrase is fine). It must not change the output structure, fields, or post type.",
    "",
  ];
}
```

- [ ] **Step 4: Run helper test to verify it passes**

Run: `bun test apps/worker/src/pipeline/prompt-blocks.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Write the failing prompt-ordering tests**

Append to `apps/worker/src/pipeline/gemini-runner.test.ts`:

```ts
import { buildPrompt, buildUrlStructuringPrompt } from "./gemini-runner";
import type { PipelineInput } from "./types";

// Minimal image-kind input; the builders only touch kind/notes/images fields.
function imageInput(notes: string): PipelineInput {
  return {
    kind: "image",
    notes,
    images: [
      { stagedFilePath: "/tmp/a.jpg", extension: "jpg" },
    ],
  } as never;
}

test("image prompt leads with the author's note, before the photo instructions", () => {
  const prompt = buildPrompt(imageInput("the broken bridge matters"), "");
  const noteIdx = prompt.indexOf("AUTHOR'S NOTE");
  const photoIdx = prompt.indexOf("photo(s) are attached");
  expect(noteIdx).toBeGreaterThan(-1);
  expect(photoIdx).toBeGreaterThan(-1);
  expect(noteIdx).toBeLessThan(photoIdx);
  // The old trailing block is gone.
  expect(prompt).not.toContain("Author's notes — their intent for this post");
  // Structure guard still present.
  expect(prompt).toContain("must not change the output structure");
});

test("image prompt has no note block when notes are empty", () => {
  const prompt = buildPrompt(imageInput("  "), "");
  expect(prompt).not.toContain("AUTHOR'S NOTE");
});

test("url structuring prompt leads with the note, before the summary; asks for an excerpt", () => {
  const prompt = buildUrlStructuringPrompt(
    "the page summary",
    "focus on pricing",
    "",
  );
  const noteIdx = prompt.indexOf("AUTHOR'S NOTE");
  const summaryIdx = prompt.indexOf("Pre-fetched URL summary:");
  expect(noteIdx).toBeGreaterThan(-1);
  expect(noteIdx).toBeLessThan(summaryIdx);
  expect(prompt).not.toContain("Author's notes — their intent for this post");
  expect(prompt.toLowerCase()).toContain("one-sentence excerpt");
});
```

- [ ] **Step 6: Run to verify the new tests fail**

Run: `bun test apps/worker/src/pipeline/gemini-runner.test.ts`
Expected: FAIL — `buildPrompt` is not exported yet (and ordering would be wrong regardless).

- [ ] **Step 7: Restructure `buildPrompt`**

In `apps/worker/src/pipeline/gemini-runner.ts`:

a. Add to the pipeline-internal imports (near the `./types` import):

```ts
import { notesLeadLines } from "./prompt-blocks";
```

b. Change the signature (~line 73) to exported, with the github-runner precedent comment:

```ts
// Exported for unit testing — the prompt is the pure, durable transformation;
// the generateText call around it isn't unit-testable without a live model.
export function buildPrompt(input: PipelineInput, voiceBlock: string): string {
```

c. In the `image` branch, insert the lead block FIRST and delete the trailing block. The branch becomes:

```ts
  if (input.kind === "image") {
    lines.push(...notesLeadLines(input.notes));
    lines.push(
      `${input.images.length} photo(s) are attached, in order. Write a SIGHT post about what is actually in them.`,
      "Title: a 2-5 word noun phrase naming the literal subject.",
      "Body: 60-160 words, first person, plain and concrete. Describe only what is visibly present — subject, setting, light, colors as plain names. Do NOT use intensifiers (almost, blinding, neon, aggressive), metaphor, simile, or mood-painting. Do NOT write image markdown, captions, or URLs in the body; the photos are shown separately by the app.",
      "Also return one short factual caption per photo in imageAlts, in the same order, and a one-sentence excerpt.",
    );
  } else if (input.kind === "note") {
```

d. In the `note` branch, add the excerpt request (notes stay the prompt body — no lead block):

```ts
  } else if (input.kind === "note") {
    lines.push(
      "Compose a short BLOG entry from the author's notes. Also return a one-sentence excerpt summarizing the entry.",
      "",
      input.notes.trim(),
    );
  } else {
```

e. In the file-kinds branch (`video | audio | document`), insert the lead block before the attachment line, add the excerpt request, and delete the trailing block:

```ts
    lines.push(...notesLeadLines(input.notes));
    lines.push(
      `A ${kindLabels[input.kind] ?? input.kind} file is attached. Write a ${postTypes[input.kind] ?? "post"}.`,
      "Be concrete, first-person, observational. No filler. 80-300 words.",
      "Also return a one-sentence excerpt summarizing the post.",
    );
```

(The two deleted trailing blocks are the `if (input.notes.trim()) { lines.push("", \`Author's notes — their intent...\`) }` stanzas at ~93-98 and ~122-127.)

- [ ] **Step 8: Restructure `buildUrlStructuringPrompt`**

Change the signature (~line 135) to `export function buildUrlStructuringPrompt(`, add the excerpt request to the instruction block, insert the lead block before the summary, and delete the trailing block:

```ts
export function buildUrlStructuringPrompt(
  summary: string,
  notes: string,
  voiceBlock: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "You are drafting a single FINDING post for a personal blog from a pre-fetched URL summary.",
    `Today's date: ${today}.`,
    "Voice: first-person, observational, concrete. 80-300 words.",
    "No marketing copy. No 'Here is' preambles. No code fences in the body.",
    "Summarize what's on the page, why it's worth noting, anything specific that surprised you. Cite any quoted phrases inline naturally.",
    "Also return a one-sentence excerpt summarizing the finding.",
    "Categories: 1-3 broad->narrow slash paths (e.g. 'technology/artificial-intelligence'); reuse common broad top-level fields, don't invent near-duplicates.",
    "",
    ...notesLeadLines(notes),
    "Pre-fetched URL summary:",
    summary,
  ];
  if (voiceBlock) {
    lines.push(voiceBlock);
  }
  return lines.join("\n");
}
```

- [ ] **Step 9: Run all worker pipeline tests**

Run: `bun test apps/worker/src/pipeline/`
Expected: all pass (including Task 1's tests and the pre-existing suites).

- [ ] **Step 10: Commit**

```bash
git add apps/worker/src/pipeline/prompt-blocks.ts apps/worker/src/pipeline/prompt-blocks.test.ts apps/worker/src/pipeline/gemini-runner.ts apps/worker/src/pipeline/gemini-runner.test.ts
git commit -m "feat(worker): author notes lead drafting prompts as primary steering input

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- apps/worker/src/pipeline/prompt-blocks.ts apps/worker/src/pipeline/prompt-blocks.test.ts apps/worker/src/pipeline/gemini-runner.ts apps/worker/src/pipeline/gemini-runner.test.ts
```

---

### Task 3: Notes-lead + excerpt request in the dedicated runners (github, twitter, youtube, document)

**Files:**
- Modify: `apps/worker/src/pipeline/github/runner.ts` (`buildGitHubPrompt`, ~lines 33-85)
- Modify: `apps/worker/src/pipeline/twitter/runner.ts` (`buildTwitterPrompt`, ~lines 64-131)
- Modify: `apps/worker/src/pipeline/youtube/runner.ts` (`buildStructuringPrompt`, ~lines 296-320 ONLY — the evidence/chunk/merge prompts keep notes in `buildSharedContext` as gathering context, deliberately)
- Modify: `apps/worker/src/pipeline/document/runner.ts` (`buildStructuringPrompt`, ~lines 45-70)
- Test: `apps/worker/src/pipeline/github/runner.test.ts` (extend — it already unit-tests `buildGitHubPrompt`)

Instagram is NOT touched (Global Constraints).

**Interfaces:**
- Consumes: `notesLeadLines` from `../prompt-blocks` (Task 2).
- Produces: no new interfaces. Excerpt passthrough already works via Task 1 (`toGeminiOutput` reads `draft.excerpt`; github's `{...output, slug}` spread and the others' direct `output` all carry it).

- [ ] **Step 1: Write the failing github prompt test**

`apps/worker/src/pipeline/github/runner.test.ts` already has a module-level `const evidence: RepoEvidence = {...}` fixture and a `describe("buildGitHubPrompt", ...)` block whose first line builds `const prompt = buildGitHubPrompt(evidence, "found via a newsletter", "")`. Append inside that `describe` block:

```ts
  test("leads with the author's note, before the repository evidence", () => {
    const noteIdx = prompt.indexOf("AUTHOR'S NOTE");
    const repoIdx = prompt.indexOf("Repository:");
    expect(noteIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeLessThan(repoIdx);
    expect(prompt).not.toContain("Author's notes (verbatim)");
    expect(prompt.toLowerCase()).toContain("one-sentence excerpt");
  });
```

Also extend the existing `omits empty notes` test to cover the new block label:

```ts
  test("omits empty notes", () => {
    const noNotes = buildGitHubPrompt(evidence, "  ", "");
    expect(noNotes).not.toContain("Author's notes");
    expect(noNotes).not.toContain("AUTHOR'S NOTE");
  });
```

(The existing `embeds the author's notes verbatim` test keeps passing — the note text is still contained, now in the lead block.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/worker/src/pipeline/github/runner.test.ts`
Expected: the new test FAILS (note currently trails); existing tests still pass.

- [ ] **Step 3: Edit `buildGitHubPrompt`**

In `apps/worker/src/pipeline/github/runner.ts`:

a. Add import: `import { notesLeadLines } from "../prompt-blocks";`

b. In the initial `lines` array, add the excerpt request after the Categories line, then spread the lead block before the `Repository:` line:

```ts
  const lines = [
    "You are drafting a single FINDING post for a personal blog about a GitHub repository.",
    `Today's date: ${today}.`,
    "Voice: first-person, observational, concrete. 120-320 words.",
    "No marketing copy. No 'Here is' preambles. Write prose, not a file listing — you may name key files inline but do not paste large code blocks or code fences in the body.",
    "Describe what the project is, the problem it solves, how it's built (language/stack), and anything notable about its structure or approach. Ground every claim in the evidence below — do not invent features.",
    "Also return a one-sentence excerpt summarizing the finding.",
    "Categories: 1-3 broad->narrow slash paths (e.g. 'software/developer-tools'); reuse common broad top-level fields, don't invent near-duplicates.",
    "",
    ...notesLeadLines(notes),
    `Repository: ${evidence.owner}/${evidence.repo}`,
  ];
```

c. Delete the trailing block:

```ts
  if (notes.trim()) {
    lines.push("", `Author's notes (verbatim): ${notes.trim()}`);
  }
```

- [ ] **Step 4: Edit `buildTwitterPrompt`**

In `apps/worker/src/pipeline/twitter/runner.ts`:

a. Add import: `import { notesLeadLines } from "../prompt-blocks";`

b. In the initial `lines` array, insert the excerpt request + lead block before the `"## Tweet evidence"` heading:

```ts
    "Do not fabricate engagement numbers, claims, or context beyond the evidence below.",
    "Also return a one-sentence excerpt summarizing the post.",
    "",
    ...notesLeadLines(notes),
    "## Tweet evidence",
```

c. Delete the trailing block:

```ts
  if (notes.trim()) {
    lines.push("", "## The saver's own notes", notes.trim());
  }
```

- [ ] **Step 5: Edit youtube `buildStructuringPrompt`**

In `apps/worker/src/pipeline/youtube/runner.ts` (~lines 296-320):

a. Add import: `import { notesLeadLines } from "../prompt-blocks";`

b. Replace the function body's array + trailing block:

```ts
  const lines = [
    "You are drafting a single FINDING post for a personal blog from a pre-gathered YouTube evidence summary.",
    `Today's date: ${today}.`,
    "Voice: first-person, observational, concrete. 120-300 words.",
    "No marketing copy. No 'Here is' preambles. No code fences in the body.",
    "Lead with what the video is and why it's worth a look. Keep any timestamps already present in the evidence summary — they're real and useful as deeplinks.",
    "Also return a one-sentence excerpt summarizing the finding.",
    "",
    ...notesLeadLines(notes),
    "Evidence summary:",
    summary,
  ];
  if (voiceBlock) {
    lines.push(voiceBlock);
  }
  return lines.join("\n");
```

(The deleted trailing stanza is `if (notes.trim()) { lines.push("", \`Author's notes (verbatim): ...\`) }`. Do NOT touch `buildSharedContext` / `buildEvidencePrompt` / `buildChunkPrompt` / `buildMergePrompt` / `buildAnalysisPrompt` — notes there are evidence-gathering context, not the drafting prompt.)

- [ ] **Step 6: Edit document `buildStructuringPrompt`**

In `apps/worker/src/pipeline/document/runner.ts` (~lines 45-70), same pattern:

a. Add import: `import { notesLeadLines } from "../prompt-blocks";`

b. Replace the array + delete the trailing block:

```ts
  const lines = [
    "You are drafting a single FINDING post for a personal blog from pre-extracted document content.",
    `Today's date: ${today}.`,
    "Voice: first-person, observational, concrete. 80-300 words.",
    "No marketing copy. No 'Here is' preambles. No code fences in the body.",
    "Summarize what the document is, its key claims, and why it's worth noting. Cite any quoted phrases inline naturally.",
    "Also return a one-sentence excerpt summarizing the finding.",
    "Categories: 1-3 broad->narrow slash paths (e.g. 'technology/artificial-intelligence'); reuse common broad top-level fields, don't invent near-duplicates.",
    "",
    ...notesLeadLines(notes),
    "Extracted document content:",
    evidence,
  ];
  if (voiceBlock) {
    lines.push(voiceBlock);
  }
  return lines.join("\n");
```

- [ ] **Step 7: Run tests + typecheck**

Run: `bun test apps/worker/src/pipeline/`
Expected: all pass, including the new github ordering test.
Run: `bunx turbo check-types --filter=worker --force`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/pipeline/github/runner.ts apps/worker/src/pipeline/github/runner.test.ts apps/worker/src/pipeline/twitter/runner.ts apps/worker/src/pipeline/youtube/runner.ts apps/worker/src/pipeline/document/runner.ts
git commit -m "feat(worker): notes-lead + excerpt request in github/twitter/youtube/document runners

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- apps/worker/src/pipeline/github/runner.ts apps/worker/src/pipeline/github/runner.test.ts apps/worker/src/pipeline/twitter/runner.ts apps/worker/src/pipeline/youtube/runner.ts apps/worker/src/pipeline/document/runner.ts
```

---

### Task 4: Central first-sentence excerpt fallback in post-writer

**Files:**
- Create: `apps/worker/src/pipeline/excerpt.ts`
- Test: `apps/worker/src/pipeline/excerpt.test.ts` (new)
- Modify: `apps/worker/src/pipeline/post-writer.ts` (excerpt derivation, ~lines 420-423)

**Interfaces:**
- Produces: `firstSentenceExcerpt(markdown: string): string | null` — first sentence of the first prose line, ≤200 chars, `null` when the body has no prose. Task 5's backfill imports it.
- Consumes: nothing from earlier tasks (independent of them; ordering here is just for narrative).

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/src/pipeline/excerpt.test.ts`:

```ts
import { expect, test } from "bun:test";
import { firstSentenceExcerpt } from "./excerpt";

test("takes the first sentence of plain prose", () => {
  expect(
    firstSentenceExcerpt("I walked the trail today. It was muddy."),
  ).toBe("I walked the trail today.");
});

test("skips the worker's Source: line and embeds", () => {
  const body =
    "Source: https://example.com\n\nThe article argues X. More detail.\n";
  expect(firstSentenceExcerpt(body)).toBe("The article argues X.");
  const yt = `<YouTubeEmbed url="https://youtu.be/abc" />\n\nGreat video about Y. And more.\n`;
  expect(firstSentenceExcerpt(yt)).toBe("Great video about Y.");
});

test("skips headings, dividers, image markdown, and blockquotes", () => {
  const body = "# Title\n\n---\n\n![alt](/x.png)\n\n> quoted\n\nReal prose here. Next.";
  expect(firstSentenceExcerpt(body)).toBe("Real prose here.");
});

test("never reads into the OCR extracted-text section", () => {
  const body = "---\n\n**Extracted text:**\n\nSIGN TEXT FROM PHOTO";
  expect(firstSentenceExcerpt(body)).toBeNull();
});

test("clamps to 200 chars", () => {
  const long = `${"word ".repeat(80)}end.`;
  expect(firstSentenceExcerpt(long)?.length).toBe(200);
});

test("returns null for empty input", () => {
  expect(firstSentenceExcerpt("")).toBeNull();
  expect(firstSentenceExcerpt("\n\n")).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/worker/src/pipeline/excerpt.test.ts`
Expected: FAIL — "Cannot find module './excerpt'".

- [ ] **Step 3: Implement the helper**

Create `apps/worker/src/pipeline/excerpt.ts`:

```ts
// Fallback excerpt derivation: the first sentence of the first real prose line
// of a post body, clamped to 200 chars. Used by post-writer when the model
// didn't supply an excerpt (so NO post is created excerpt-null — the field
// carries weight C in searchVector and feeds catalog cards, search snippets,
// and cover-image prompts) and by the one-time backfill script for old rows.
//
// Skips the non-prose lines the worker wraps around the drafted text:
// "Source: <url>" lines, JSX embeds (<YouTubeEmbed .../>), markdown headings,
// dividers, image markdown, blockquotes — and never reads past the OCR
// "**Extracted text:**" section (that's sign/scan text, not a summary).
export function firstSentenceExcerpt(markdown: string): string | null {
  const proseOnly = markdown.split("**Extracted text:**")[0] ?? markdown;
  for (const rawLine of proseOnly.split("\n")) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith("Source:") ||
      line.startsWith("<") ||
      line.startsWith("#") ||
      line.startsWith("---") ||
      line.startsWith("![") ||
      line.startsWith(">")
    ) {
      continue;
    }
    const sentence = line.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (sentence) {
      return sentence.slice(0, 200);
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test apps/worker/src/pipeline/excerpt.test.ts`
Expected: 6 pass.

- [ ] **Step 5: Wire the fallback into post-writer**

In `apps/worker/src/pipeline/post-writer.ts`:

a. Add import (with the other `./` pipeline imports at the top):

```ts
import { firstSentenceExcerpt } from "./excerpt";
```

b. Replace (~lines 420-423):

```ts
  const excerpt =
    typeof parsed.frontmatter.excerpt === "string"
      ? (parsed.frontmatter.excerpt as string)
      : null;
```

with:

```ts
  // Model-provided excerpt wins; otherwise derive a first-sentence fallback so
  // no post is created without a summary line (weight C in searchVector; feeds
  // catalog cards, search snippets, and the cover-image prompt below).
  const excerpt =
    typeof parsed.frontmatter.excerpt === "string" &&
    parsed.frontmatter.excerpt.trim()
      ? (parsed.frontmatter.excerpt as string)
      : firstSentenceExcerpt(body);
```

- [ ] **Step 6: Run the post-writer suite + typecheck**

Run: `bun test apps/worker/src/pipeline/post-writer.test.ts`
Expected: PASS. If an existing assertion pins `excerpt: null` on the upsert payload for a note ingest, update that expectation to the derived first sentence of the fixture body — that change is the point of this task.
Run: `bunx turbo check-types --filter=worker --force`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/pipeline/excerpt.ts apps/worker/src/pipeline/excerpt.test.ts apps/worker/src/pipeline/post-writer.ts
git commit -m "feat(worker): central first-sentence excerpt fallback — no post is excerpt-null

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- apps/worker/src/pipeline/excerpt.ts apps/worker/src/pipeline/excerpt.test.ts apps/worker/src/pipeline/post-writer.ts
```

---

### Task 5: Excerpt backfill script

**Files:**
- Create: `apps/worker/src/scripts/backfill-excerpts.ts`
- Modify: `apps/worker/package.json` (add `"backfill:excerpts"` script)

**Interfaces:**
- Consumes: `firstSentenceExcerpt` from `../pipeline/excerpt` (Task 4), `prisma` from `@repo/db`.
- Produces: CLI script; no code interfaces.

- [ ] **Step 1: Write the script**

Create `apps/worker/src/scripts/backfill-excerpts.ts` (conventions mirror `backfill-cover-images.ts`):

```ts
// One-time backfill: derive an excerpt for existing posts that have none.
// New posts get an excerpt inline in the worker pipeline (model-written, with
// a first-sentence fallback in post-writer); this fills the gap for everything
// ingested before that landed — excerpt carries weight C in searchVector and
// feeds catalog cards, search snippets, and cover-image prompts, so null rows
// silently lose ranking + UI surface.
//
// Deterministic (no AI): the same firstSentenceExcerpt(content) the pipeline
// uses as its fallback. Posts with a non-empty excerpt (e.g. manually edited)
// are never touched; the searchVector trigger fires ON UPDATE OF excerpt, so
// updated rows re-rank automatically.
//
// Run from apps/worker/:
//   bun run src/scripts/backfill-excerpts.ts --dry-run
//   bun run src/scripts/backfill-excerpts.ts --limit=20
//   bun run src/scripts/backfill-excerpts.ts                  # all users
//   bun run src/scripts/backfill-excerpts.ts --user=a@b.com   # one owner
//
// Flags:
//   --dry-run     list the posts + derived excerpt; write nothing
//   --limit=N     cap how many posts to process (newest first)
//   --user=EMAIL  only this owner's posts (matches Post.submittedBy.email)

import { prisma } from "@repo/db";
import { firstSentenceExcerpt } from "../pipeline/excerpt";

function color(code: number, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (s: string) => color(32, s);
const yellow = (s: string) => color(33, s);
const dim = (s: string) => color(90, s);
const bold = (s: string) => color(1, s);

type Args = { dryRun: boolean; limit: number | null; userEmail: string | null };

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let limit: number | null = null;
  let userEmail: string | null = null;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (arg.startsWith("--user=")) {
      userEmail = arg.slice("--user=".length) || null;
    }
  }
  return { dryRun, limit, userEmail };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const posts = await prisma.post.findMany({
    where: {
      OR: [{ excerpt: null }, { excerpt: "" }],
      ...(args.userEmail
        ? { submittedBy: { email: args.userEmail } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    ...(args.limit ? { take: args.limit } : {}),
    select: { id: true, slug: true, content: true },
  });
  console.log(bold(`${posts.length} post(s) with no excerpt`));

  let written = 0;
  let skipped = 0;
  for (const post of posts) {
    const excerpt = firstSentenceExcerpt(post.content);
    if (!excerpt) {
      skipped++;
      console.log(`${yellow("skip")} ${post.slug} ${dim("(no prose found)")}`);
      continue;
    }
    if (args.dryRun) {
      console.log(`${dim("dry")}  ${post.slug} → ${excerpt}`);
      continue;
    }
    await prisma.post.update({ where: { id: post.id }, data: { excerpt } });
    written++;
    console.log(`${green("set")}  ${post.slug} → ${excerpt}`);
  }
  console.log(
    bold(
      args.dryRun
        ? `dry-run: ${posts.length - skipped} would be set, ${skipped} skipped`
        : `done: ${written} set, ${skipped} skipped`,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add the package script**

In `apps/worker/package.json` scripts, after `"backfill:video-thumbnails"`:

```json
		"backfill:excerpts": "bun run src/scripts/backfill-excerpts.ts",
```

- [ ] **Step 3: Dry-run against the local DB (real execution)**

Run: `cd apps/worker && bun run backfill:excerpts -- --dry-run --limit=10` (if `bun run` swallows flags, invoke directly: `bun run src/scripts/backfill-excerpts.ts --dry-run --limit=10`)
Expected: prints N posts with sensible derived excerpts, writes nothing. Eyeball the derived lines — no "Source: http…" leakage, no OCR text.

- [ ] **Step 4: Typecheck + lint**

Run: `bunx turbo check-types lint --filter=worker --force`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/scripts/backfill-excerpts.ts apps/worker/package.json
git commit -m "feat(worker): deterministic excerpt backfill script (backfill:excerpts)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- apps/worker/src/scripts/backfill-excerpts.ts apps/worker/package.json
```

(The REAL backfill run happens in Task 7 validation, after the user confirms the dry-run output looks right.)

---

### Task 6: Chat `get_post` returns the owner's original notes

**Files:**
- Modify: `apps/web/lib/chat/agent.ts`
- Modify: `packages/research-agent/src/prompt.ts` (`AGENT_SYSTEM_PROMPT`)
- Test: `apps/web/lib/chat/agent.test.ts` (extend)

**Interfaces:**
- Consumes: `listSourceSubmissionsForPost(postId: string): Promise<IngestSubmission[]>` (from `@repo/db`), `rawNotesFor(payload: unknown): { notes: string; urls: string[] }` (from `../originals/original-content`), `findPostBySlug` result's `submittedById` + `id` fields (already on the `Post` row).
- Produces: `ownerNotesBlock(submissions: Array<Pick<IngestSubmission, "payload">>): string` exported from `agent.ts` for testing — `""` when no notes, else a `\n`-joined trailer starting with `---`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/lib/chat/agent.test.ts`:

```ts
import { ownerNotesBlock } from "./agent";

test("ownerNotesBlock renders each submission's note text under a labeled trailer", () => {
  const block = ownerNotesBlock([
    { payload: { notes: "the trail where the bridge broke" } },
    { payload: { notes: "" } },
    { payload: { contentType: "image/jpeg" } },
    { payload: { notes: "second note" } },
  ] as never);
  expect(block).toContain("Author's original submission notes");
  expect(block).toContain("the trail where the bridge broke");
  expect(block).toContain("second note");
  expect(block.startsWith("\n---\n")).toBe(true);
});

test("ownerNotesBlock returns empty string when no submission has notes", () => {
  expect(ownerNotesBlock([] as never)).toBe("");
  expect(
    ownerNotesBlock([{ payload: { notes: "  " } }] as never),
  ).toBe("");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/web/lib/chat/agent.test.ts`
Expected: FAIL — `ownerNotesBlock` is not exported.

- [ ] **Step 3: Implement in `agent.ts`**

a. Extend the `@repo/db` import:

```ts
import {
  findPostBySlug,
  listSourceSubmissionsForPost,
  requireApiKey,
  searchCorpus,
  type IngestSubmission,
  type PostWithRelations,
  type SearchHit,
} from "@repo/db";
```

b. Add import: `import { rawNotesFor } from "../originals/original-content";`

c. Add the pure helper (below `postToFullPost`):

```ts
// The verbatim text the owner typed at capture, as a clearly-labeled trailer
// for get_post results. OWNER-ONLY: callers must gate on
// post.submittedById === viewerId before appending — friends' shared posts
// must never expose their submission notes to another viewer's chat.
export function ownerNotesBlock(
  submissions: Array<Pick<IngestSubmission, "payload">>,
): string {
  const notes = submissions
    .map((s) => rawNotesFor(s.payload).notes)
    .filter((n) => n.length > 0);
  if (notes.length === 0) {
    return "";
  }
  return [
    "",
    "---",
    "Author's original submission notes (verbatim):",
    ...notes,
  ].join("\n");
}
```

d. In `buildChatDeps`, replace the `getPost` closure with:

```ts
  const getPost: AskAgentDeps["getPost"] = async (id) => {
    if (!candidateBySlug.has(id)) return null; // not surfaced to this viewer
    const post = await findPostBySlug(id);
    if (!post) return null;
    onPostOpened?.({
      serverId: post.slug,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
    });
    const full = postToFullPost(post);
    // Owner-only: append the author's original capture notes so the agent can
    // ground on what the user actually said, not just the generated post.
    // Never for peers' posts — their notes are private (see ownerNotesBlock).
    if (post.submittedById === viewerId) {
      const block = ownerNotesBlock(
        await listSourceSubmissionsForPost(post.id),
      );
      if (block) {
        full.body += `\n${block}`;
      }
    }
    return full;
  };
```

- [ ] **Step 4: Add the system-prompt line**

In `packages/research-agent/src/prompt.ts`, inside `AGENT_SYSTEM_PROMPT`, directly after the `get_post` bullet line (`"- get_post(id): open ONE candidate and read its full text, tags, and date."`), insert:

```ts
  '  Posts the user owns may end with an "Author\'s original submission notes"',
  "  section — their verbatim words at capture time. Treat those notes as the",
  "  author's intent and use them when they answer the question.",
```

(This prompt is shared with the parked on-device agent — harmless there: the section simply never appears in its posts.)

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test apps/web/lib/chat/`
Expected: all pass (existing `hitToCandidate`/`postToFullPost`/ui-stream tests + the 2 new ones).
Run: `bunx turbo check-types --filter=web --filter=@repo/research-agent --force`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/chat/agent.ts apps/web/lib/chat/agent.test.ts packages/research-agent/src/prompt.ts
git commit -m "feat(chat): get_post returns the owner's original submission notes (owner-gated)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- apps/web/lib/chat/agent.ts apps/web/lib/chat/agent.test.ts packages/research-agent/src/prompt.ts
```

---

### Task 7: End-to-end validation (real execution) + review

**Files:** none created (validation only). Requires `GEMINI_API_KEY` in root `.env` and the local dev DB up.

- [ ] **Step 1: Full typecheck + lint, cache-busted**

Run: `bunx turbo check-types lint --filter=worker --filter=web --filter=@repo/ingest-draft --filter=@repo/research-agent --force`
Expected: PASS with real (non-`FULL TURBO`) execution.

- [ ] **Step 2: Full worker + web-chat unit suites**

Run: `bun test apps/worker/src/ && bun test apps/web/lib/chat/`
Expected: all pass.

- [ ] **Step 3: REAL Gemini run — image + pointed note (the bug that started this)**

From repo root (loads `.env`):

```bash
bun run gen:try --kind image --image apps/web/public/IMG_4297.JPG \
  --notes "this is my grandfather's old workbench — what matters is that he built it himself in 1962, mention that"
```

Expected: the printed draft's BODY substantively incorporates the note (workbench + built-himself + 1962), and the printed frontmatter includes a non-empty `excerpt`. The `prompt:built`-style output shows notes applied. If the note's substance is absent from the body, the prompt restructure failed its purpose — iterate on `notesLeadLines` wording before proceeding.

- [ ] **Step 4: REAL Gemini runs — url and note kinds get excerpts**

```bash
bun run gen:try --kind url --url https://example.com --notes "focus on why this domain exists"
bun run gen:try --kind note --note "weekend trip to the coast; the tide pools were full of anemones"
```

Expected: both drafts print a non-empty `excerpt` in frontmatter (model-written; if the model omitted it, that's still OK — the post-writer fallback covers persistence, but note it).

- [ ] **Step 5: Excerpt backfill — dry-run, show the user, then real run**

```bash
cd apps/worker
bun run src/scripts/backfill-excerpts.ts --dry-run
```

Show the derived excerpts to the user. On their OK:

```bash
bun run src/scripts/backfill-excerpts.ts
```

Then spot-check: `cd ../.. && bun run db:studio` (or SQL) — confirm previously-null excerpts are set and a manually-edited post was untouched.

- [ ] **Step 6: Chat validation — user manual test (preferred per project convention)**

Ask the user to run the dev stack (`! bun run dev` — portless needs interactive sudo) and, in the mobile `/llm` chat or web chat surface:
1. Ask about a post they submitted WITH a capture note using wording that only exists in the note → the answer should reflect the note's content.
2. Ask about a friend's shared post → confirm nothing note-like appears (privacy invariant).
Report back specific results.

- [ ] **Step 7: Adversarial review of the full diff**

Dispatch a code review over `git diff <base>..HEAD` for the six commits (base = commit before Task 1). Focus points: privacy gate in `getPost` (owner check placement, no notes on the `onPostOpened` source card), excerpt clamp consistency (200 everywhere), no prompt regression for the note/BLOG path, post-writer fallback not clobbering model excerpts, backfill's manually-edited-post protection (non-empty excerpt rows excluded by the `where`).

- [ ] **Step 8: Session close-out (swarm protocol)**

```bash
git status                    # verify only our files are modified
br sync --flush-only          # if any beads were touched
```

Push only if the user asks (push requires unsandboxed git + the id_rsa_git SSH config).
