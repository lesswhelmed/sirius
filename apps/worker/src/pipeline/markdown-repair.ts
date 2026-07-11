// Collapsed-markdown guardrail. Gemini's JSON-mode structured output
// occasionally returns the analysis body with its newlines stripped — the
// whole document on one line, `##` headings inline — which markdown renders
// as one giant h2 (observed in prod: slug black-cat-mala, 2026-07-10). The
// contract prompt now demands real newlines, but this repairs the output
// deterministically when the model ignores it: steer in the prompt, enforce
// in code, same pattern as the tag/excerpt clamps in toGeminiOutput.
//
// The repair is strictly structural — it only inserts newlines around the
// KNOWN contract headings and never adds, removes, or reorders a single
// word. It is also gated: a body with no collapse signature (a known
// heading mid-line, or a known heading sharing its line with sentence-like
// prose) is returned byte-identical, so well-formed bodies — and verbatim
// human text that merely mentions `##` — pass through untouched.

import { ANALYSIS_SECTION_TITLES } from "./analysis-contract";

// Titles the repairer recognizes: the shared contract set plus the extra
// sections type-specific prompts append (see AnalysisContractOpts.extraSections
// and the OCR append in gemini-runner).
const KNOWN_TITLES: readonly string[] = [
  ...ANALYSIS_SECTION_TITLES,
  "Extracted text",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest-first so "Full breakdown" wins over any shorter overlap.
const TITLE_ALT = [...KNOWN_TITLES]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join("|");

// A known heading, case-insensitive (models drift to Title Case), that must
// end at a word-ish boundary so "Overview" never matches "Overviewing". The
// `(?<!#)` keeps the marker strictly h2: legacy posts carry `### Overview`
// (h3) appendix sections whose trailing `##` must never match.
const HEADING = `(?<!#)##\\s(?:${TITLE_ALT})(?=[\\s.:,;!?)\\]—–-]|$)`;

// Collapse signature 1: a known heading marker mid-line (non-newline char
// before it on the same line). `[ \t]*` — NOT `\s*` — so a preceding real
// newline never matches.
const MID_LINE = new RegExp(`[^\\n][ \\t]*${HEADING}`, "i");

// Collapse signature 2: a known heading on its own line but with prose run
// together after the title. "Sentence-like" = contains sentence punctuation
// or is long — so a legit longer custom heading ("## Overview of the trip")
// is not mistaken for collapsed prose.
const TRAILING_PROSE = new RegExp(
  `^${HEADING}:?[ \\t]+(?=\\S)([^\\n]+)$`,
  "gim",
);

function proseLike(rest: string): boolean {
  return /[.!?]/.test(rest) || rest.length >= 80;
}

export function repairCollapsedMarkdown(body: string): string {
  TRAILING_PROSE.lastIndex = 0;
  const trailing = [...body.matchAll(TRAILING_PROSE)].some((m) =>
    proseLike(m[1] ?? ""),
  );
  if (!MID_LINE.test(body) && !trailing) {
    return body;
  }

  let out = body;
  // 1. Every known heading marker starts its own paragraph.
  out = out.replace(
    new RegExp(`([^\\n])[ \\t]*(?=${HEADING})`, "gi"),
    "$1\n\n",
  );
  // 2. The heading line carries ONLY the title; run-on prose becomes the
  //    section's first paragraph (title casing preserved as the model wrote it).
  out = out.replace(
    new RegExp(`^(##\\s(?:${TITLE_ALT})):?[ \\t]+(\\S[^\\n]*)$`, "gim"),
    (match, title: string, rest: string) =>
      proseLike(rest) ? `${title}\n\n${rest}` : match,
  );
  // 3. A note divider swept up in the collapse ("note --- ## Overview …")
  //    lands on its own line instead of dangling at the end of the note.
  out = out.replace(/([^\n])[ \t]+---(?=\n\n##\s)/g, "$1\n\n---");
  // 4. Tidy any accidental triple blank runs the splits introduced.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}
