// Regression test for security fix #1 (HIGH): a client-supplied `draft` envelope
// is published VERBATIM (tryClientDraft skips Gemini), so its user-authored text
// MUST be routed through the content-safety gate. The fix in
// apps/worker/src/pipeline/safety/targets.ts added `collectDraftTargets` (so the
// draft body/title/excerpt/alts become scan targets) plus a `shouldScan`
// early-return that forces the gate whenever a draft is present — closing the
// hole where benign notes + a harmful draft would skip scanning entirely.
//
// HEADLESS + network-free: all target-collection assertions use `kind: "note"`
// inputs (a `url` kind can trigger a PDF HEAD/download inside collectScanTargets;
// a `note` never touches the network or filesystem). `shouldScan` is pure.
import { test, expect } from "bun:test";
import {
  collectScanTargets,
  shouldScan,
  type ScanTarget,
} from "../../../apps/worker/src/pipeline/safety/targets";
import type { PipelineInput, StagedImage } from "../../../apps/worker/src/pipeline/types";
import type { SafetyConfig } from "../../../apps/worker/src/pipeline/safety/config";
import type {
  DraftEnvelope,
  SightDraftEnvelope,
} from "../../../packages/ingest-draft/src/index";

// collectScanTargets requires a SafetyConfig; only cfg.maxPdfBytes matters and
// only on the (unused-here) PDF-url path, so any valid config works.
const cfg: SafetyConfig = {
  enabled: true,
  model: "gemini-2.5-flash-lite",
  blockSeverity: "medium",
  alertEmail: "test@example.com",
  maxPdfBytes: 25 * 1024 * 1024,
  scanRetries: 2,
};

// collectScanTargets / shouldScan never read submission fields for note/url, so a
// cast stub is sufficient (and keeps the test free of Prisma/db imports).
const fakeSubmission = {} as PipelineInput extends { submission: infer S } ? S : never;

const BODY_SENTINEL = "UNIQUE_SENTINEL_BODY_9f3a";
const TITLE_SENTINEL = "UNIQUE_SENTINEL_TITLE_7b2c";
const EXCERPT_SENTINEL = "UNIQUE_SENTINEL_EXCERPT_5d1e";
const ALT_SENTINEL = "UNIQUE_SENTINEL_ALT_3c9f";

function textDraftEnvelope(): DraftEnvelope {
  return {
    schemaVersion: 1,
    engine: "test-engine",
    draftedAt: new Date().toISOString(),
    post: {
      title: TITLE_SENTINEL,
      tags: ["tag-a"],
      categories: ["technology/testing"],
      body: BODY_SENTINEL,
    },
  };
}

function sightDraftEnvelope(): SightDraftEnvelope {
  return {
    schemaVersion: 1,
    engine: "test-engine",
    draftedAt: new Date().toISOString(),
    post: {
      title: TITLE_SENTINEL,
      tags: ["tag-a"],
      categories: ["objects/testing"],
      body: BODY_SENTINEL,
      excerpt: EXCERPT_SENTINEL,
      imageAlts: [ALT_SENTINEL],
    },
  };
}

function noteInputWithDraft(draft: unknown): PipelineInput {
  return {
    kind: "note",
    submission: fakeSubmission,
    notes: "",
    draft,
    submittedById: "user-1",
    projectId: null,
  };
}

function urlInput(opts: { draft?: unknown }): PipelineInput {
  return {
    kind: "url",
    submission: fakeSubmission,
    urls: ["https://example.com/article"], // non-PDF, non-third-party
    notes: "",
    force: false,
    draft: opts.draft,
    submittedById: "user-1",
    projectId: null,
  };
}

const textTargets = (targets: ScanTarget[]) =>
  targets.filter((t): t is Extract<ScanTarget, { kind: "text" }> => t.kind === "text");

// #1 — Draft body becomes a scan target. Maps to the core vuln: a verbatim-
// published draft body must be scanned. Pre-fix: no draft target existed.
test("draft body becomes a text scan target", async () => {
  const targets = await collectScanTargets(noteInputWithDraft(textDraftEnvelope()), cfg);
  const hit = textTargets(targets).some((t) => t.text.includes(BODY_SENTINEL));
  expect(hit).toBe(true);
});

// #2 — Draft title is also scanned. Title is user-authored + published verbatim.
test("draft title is also scanned", async () => {
  const targets = await collectScanTargets(noteInputWithDraft(textDraftEnvelope()), cfg);
  const hit = textTargets(targets).some((t) => t.text.includes(TITLE_SENTINEL));
  expect(hit).toBe(true);
});

// #3 — shouldScan forces the gate on the single-URL bypass path when a draft is
// present. Pre-fix this path returned false (benign notes + harmful draft = no
// scan). This is the exact early-return the fix added.
test("shouldScan forces the gate for a url+draft submission", () => {
  expect(shouldScan(urlInput({ draft: textDraftEnvelope() }))).toBe(true);
});

// #4 — No over-fix: a plain single non-PDF url with no notes + no draft still
// bypasses the gate (third-party bookmarking is out of scope, unchanged).
test("shouldScan still bypasses a plain url with no draft", () => {
  expect(shouldScan(urlInput({ draft: undefined }))).toBe(false);
});

// #5 — Image (SIGHT) drafts: body + per-image alt text are scanned too, via the
// SightDraftEnvelopeSchema branch of collectDraftTargets.
test("sight draft body and image alts are scanned", async () => {
  const input: PipelineInput = {
    kind: "image",
    submissions: [fakeSubmission as never],
    batchId: "batch-1",
    notes: "",
    draft: sightDraftEnvelope(),
    images: [] as StagedImage[], // no staged files → no fs reads
    submittedById: "user-1",
    projectId: null,
  };
  const targets = await collectScanTargets(input, cfg);
  const texts = textTargets(targets);
  expect(texts.some((t) => t.text.includes(BODY_SENTINEL))).toBe(true);
  expect(texts.some((t) => t.text.includes(ALT_SENTINEL))).toBe(true);
  expect(texts.some((t) => t.text.includes(EXCERPT_SENTINEL))).toBe(true);
});
