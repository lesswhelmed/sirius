// Unit tests for the collapsed-markdown guardrail. Gemini's JSON-mode output
// occasionally emits the whole analysis body as ONE line — `##` headings
// inline, zero newlines — which renders as a giant h2 (observed in prod on
// slug black-cat-mala, 2026-07-10). The repairer re-inserts the structural
// newlines deterministically around the KNOWN contract headings and never
// alters the words themselves.
import { expect, test } from "bun:test";
import { analysisContractLines, ANALYSIS_SECTION_TITLES } from "./analysis-contract";
import { repairCollapsedMarkdown } from "./markdown-repair";
import { toGeminiOutput } from "./gemini-runner";
import { buildManualStub } from "./manual-stub";
import type { PipelineInput } from "./types";

// The real prod failure, verbatim shape (abridged).
const COLLAPSED =
  "## Overview This image captures a low-angle perspective of a black cat, identified by the author as Mala, alongside a smiling man. The photograph documents the pet in an indoor domestic setting. ## Full breakdown The photograph is taken from a steep low angle, looking upward. In the foreground, a solid black cat (Mala) leans over the edge of a white, textured vertical surface. ## Entities Mala (the black cat).";

const WELL_FORMED = [
  "## Overview",
  "",
  "This image captures a black cat.",
  "",
  "## Full breakdown",
  "",
  "The photograph is taken from a steep low angle.",
  "",
  "## Entities",
  "",
  "Mala (the black cat).",
].join("\n");

// Strip all whitespace — the repairer must never add/remove/change words.
const ink = (s: string) => s.replace(/\s+/g, "");

test("collapsed single-line body is split into proper sections", () => {
  const out = repairCollapsedMarkdown(COLLAPSED);
  const lines = out.split("\n");
  expect(lines[0]).toBe("## Overview");
  expect(lines).toContain("## Full breakdown");
  expect(lines).toContain("## Entities");
  // heading lines carry ONLY the title; prose lands in its own paragraph
  for (const line of lines) {
    if (line.startsWith("## ")) {
      expect(ANALYSIS_SECTION_TITLES).toContain(line.slice(3));
    }
  }
});

test("repair never changes the content itself (whitespace-only diff)", () => {
  expect(ink(repairCollapsedMarkdown(COLLAPSED))).toBe(ink(COLLAPSED));
});

test("well-formed body is returned byte-identical", () => {
  expect(repairCollapsedMarkdown(WELL_FORMED)).toBe(WELL_FORMED);
});

test("heading line with trailing prose is split even when the rest of the doc is fine", () => {
  const body = [
    "## Overview This image captures a black cat leaning over a wall, photographed from below.",
    "",
    "## Entities",
    "",
    "Mala (the black cat).",
  ].join("\n");
  const out = repairCollapsedMarkdown(body);
  expect(out.split("\n")[0]).toBe("## Overview");
  expect(out).toContain(
    "\nThis image captures a black cat leaning over a wall, photographed from below.",
  );
  expect(ink(out)).toBe(ink(body));
});

test("a legit longer custom heading in a well-formed doc is left alone", () => {
  const body = [
    "## Overview of the trip",
    "",
    "We drove north.",
  ].join("\n");
  expect(repairCollapsedMarkdown(body)).toBe(body);
});

test("note divider collapsed inline lands on its own line", () => {
  const body =
    "Mala is my cat and I love her. --- ## Overview A short note about the author's cat, kept verbatim above the divider.";
  const out = repairCollapsedMarkdown(body);
  const lines = out.split("\n");
  expect(lines[0]).toBe("Mala is my cat and I love her.");
  expect(lines).toContain("---");
  expect(lines).toContain("## Overview");
  expect(ink(out)).toBe(ink(body).replace(/---/, "---"));
});

test("title casing drift from the model still repairs, preserving its casing", () => {
  const body =
    "## Full Breakdown The photograph is taken from a steep low angle, looking upward at the subject.";
  const out = repairCollapsedMarkdown(body);
  expect(out.split("\n")[0]).toBe("## Full Breakdown");
});

test("every contract section title is exported and present in the prompt lines", () => {
  const lines = analysisContractLines({
    kindLabel: "a photo",
    lengthHint: "150-500 words",
    breakdownHint: "photo-by-photo.",
  }).join("\n");
  for (const title of ANALYSIS_SECTION_TITLES) {
    expect(lines).toContain(`## ${title}`);
  }
});

test("h3 headings (### Overview, old-format appendix) are never mistaken for h2", () => {
  // Real prod shape: legacy YouTube posts carry a <details> appendix whose
  // sections are `### Overview` etc. The repairer must not split the `##`
  // inside `###` — neither as a gate signal nor during repair.
  const legacy = [
    "the park bench scene. sean guts that defense.",
    "",
    "<details>",
    "<summary>Full analysis</summary>",
    "",
    "### Overview",
    "",
    "This video clip features an iconic scene.",
    "",
    "</details>",
  ].join("\n");
  expect(repairCollapsedMarkdown(legacy)).toBe(legacy);

  // And when a genuine h2 collapse coexists with an h3 appendix, only the
  // h2 is repaired.
  const mixed = `${legacy}\n\nintro sentence. ## Overview A collapsed section that ran together with the intro.`;
  const out = repairCollapsedMarkdown(mixed);
  expect(out).toContain("### Overview\n");
  expect(out).not.toContain("#\n\n## Overview");
  expect(out).toContain("intro sentence.\n\n## Overview\n\nA collapsed section");
});

// The second prod variant (2026-07-11, audio ingest): Gemini double-escapes
// the JSON string, so the body arrives with LITERAL backslash-n sequences
// instead of real newlines.
const ESCAPED = String.raw`## Overview\n\nThe recording captures a brief, informal conversation between two speakers.\n\n## Full breakdown\n\nThe audio begins with a brief, unrelated exchange about an object.\n\n## Entities\n\nA former server.`;

test("literal \\n escape sequences around known headings become real newlines", () => {
  const out = repairCollapsedMarkdown(ESCAPED);
  expect(out).not.toContain("\\n");
  const lines = out.split("\n");
  expect(lines[0]).toBe("## Overview");
  expect(lines).toContain("## Full breakdown");
  expect(lines).toContain("## Entities");
  expect(out).toContain(
    "## Full breakdown\n\nThe audio begins with a brief, unrelated exchange about an object.",
  );
  // words identical once the escape sequences are accounted for
  expect(ink(out)).toBe(ink(ESCAPED.replace(/\\n/g, "\n")));
});

test("prose that merely MENTIONS \\n in a well-formed body is untouched", () => {
  const body = [
    "## Overview",
    "",
    "In C, use \\n to end a line; printf(\"a\\n\\nb\") prints a blank line.",
    "",
    "## Entities",
    "",
    "The C language.",
  ].join("\n");
  expect(repairCollapsedMarkdown(body)).toBe(body);
});

test("escaped variant combined with run-on prose still repairs fully", () => {
  const body = String.raw`intro sentence. ## Overview\n\nThe recording captures a conversation about service work.`;
  const out = repairCollapsedMarkdown(body);
  expect(out).not.toContain("\\n");
  expect(out).toContain("intro sentence.\n\n## Overview\n\nThe recording captures");
});

// The third prod variant (2026-07-11, video ingest): collapsed one-liner where
// the model copied the contract's own "## Title — guidance" formatting, so
// headings carry an em-dash separator before the prose.
test("em-dash separator after the title is treated as template, not content", () => {
  const body =
    "## Overview — The video features a cat resting near a large tree trunk, filmed from inside a vehicle. ## Full breakdown — 0:00 The video opens with a sideways view of a light-colored cat.";
  const out = repairCollapsedMarkdown(body);
  const lines = out.split("\n");
  expect(lines[0]).toBe("## Overview");
  expect(lines).toContain("## Full breakdown");
  expect(out).toContain(
    "## Overview\n\nThe video features a cat resting near a large tree trunk",
  );
  expect(out).toContain("## Full breakdown\n\n0:00 The video opens");
  // only the structural em-dashes may differ
  expect(ink(out)).toBe(ink(body.replace(/## (Overview|Full breakdown) — /g, "## $1 ")));
});

test("toGeminiOutput repairs a collapsed drafted body", () => {
  const out = toGeminiOutput(
    {
      title: "Black Cat Mala",
      tags: [],
      categories: [],
      body: COLLAPSED,
    },
    "SIGHT",
  );
  expect(out.body).toContain("## Overview\n");
  expect(out.body).toContain("\n\n## Full breakdown\n");
});

test("manual stub body stays verbatim even if the user's note looks collapsed", () => {
  const note =
    "reminder to self ## Overview I keep writing markdown in my notes. Do not reformat me.";
  const input = {
    kind: "note",
    notes: note,
    urls: [],
    images: [],
    submission: { originalFilename: null },
  } as unknown as PipelineInput;
  const out = buildManualStub(input);
  expect(out.body).toContain(note);
});
