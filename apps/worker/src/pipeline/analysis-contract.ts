// The shared RAW-ANALYSIS contract — the single instruction block every
// material-type prompt builder embeds so all analyses read as one system.
//
// Product intent (2026-07 pivot): the model no longer ghost-writes a stylized
// post "in the user's voice". It produces a maximal-detail neutral analysis of
// the ingested material; the HUMAN layer comes later, via reflection prompts
// the owner answers themselves (pipeline/reflection). The author's voice
// profile therefore no longer shapes any body — it now personalizes the
// reflection questions instead.
//
// The body still lands in Post.content, so richer analyses directly enrich
// full-text search (weight D) and the retrieval embeddings with zero schema
// changes. escapeMdxProse leaves `##` headings and tables intact, and
// Streamdown/PostBody render them on both hosts (the Instagram digest proved
// the structured-markdown path).

// The canonical `##` section titles of the shared contract, in order. The
// collapsed-markdown guardrail (markdown-repair.ts) keys on these to re-insert
// structural newlines when Gemini's JSON mode strips them — a drift test in
// markdown-repair.test.ts asserts every title appears in the prompt lines.
export const ANALYSIS_SECTION_TITLES: readonly string[] = [
  "Overview",
  "Full breakdown",
  "Key claims & facts",
  "Notable quotes",
  "Entities",
  "Data & numbers",
  "Context & metadata",
  "Open questions",
];

export type AnalysisContractOpts = {
  // Human label for what's being analyzed, with article ("a web page",
  // "a set of photos", "a video"). Used in the framing line.
  kindLabel: string;
  // Length guidance, e.g. "300-1200 words". Depth is material-bound, not
  // padded — the standing rules say so explicitly.
  lengthHint: string;
  // Type-appropriate guidance for the "Full breakdown" section (the deep
  // extraction): argument structure / timeline / scene-by-scene / photo-by-
  // photo / section-by-section, whatever fits the material.
  breakdownHint: string;
  // Extra `##` sections a type wants beyond the shared set (e.g. a document
  // path adding "## Extracted text — verbatim passages that carry the
  // substance"). Appended after the shared sections, before Open questions.
  extraSections?: string[];
};

// The instruction block, as prompt lines. Builders spread this into their
// prompt after their type-specific framing and before the material itself.
export function analysisContractLines(opts: AnalysisContractOpts): string[] {
  return [
    `You are producing a RAW ANALYSIS of ${opts.kindLabel} for the owner's personal knowledge base — a maximal-detail extraction, not a stylized post.`,
    "Voice: neutral analyst, third person. Never write as \"I\"; never impersonate the author.",
    `Capture as much specific detail as the material warrants (${opts.lengthHint}). Depth beats brevity, but never pad, editorialize, or restate to fill space.`,
    "",
    "Structure the body with `##` markdown sections. ATTEMPT each section below; OMIT a section entirely when the material genuinely has nothing for it (no empty headings, no 'N/A'):",
    "Formatting: the body MUST contain real newline characters — every `##` heading on its own line with a blank line before and after it. Never run a heading and its prose together on one line.",
    "## Overview — 2-4 sentences: what this is and why it's worth keeping.",
    `## Full breakdown — ${opts.breakdownHint}`,
    "## Key claims & facts — the concrete assertions, findings, and decisions, each grounded in the material.",
    "## Notable quotes — verbatim and attributed; only words that actually appear in the material.",
    "## Entities — people, organizations, products, places, and works referenced.",
    "## Data & numbers — figures, statistics, prices, dates, measurements.",
    "## Context & metadata — provenance: author/creator, date, platform, and links or works the material itself points to.",
    ...(opts.extraSections ?? []),
    "## Open questions — what the material leaves unresolved or worth investigating next.",
    "",
    "Standing rules: ground every statement in the material — never invent. No 'Here is' preambles, no marketing copy. Do not wrap the body in code fences. Never embed image markdown or URLs in the body (media renders separately).",
    "Also return a short plainspoken title naming the subject, and a one-sentence excerpt (plain language, for a feed card).",
    "Categories: 1-3 broad->narrow slash paths (e.g. 'technology/artificial-intelligence'); reuse common broad top-level fields, don't invent near-duplicates.",
  ];
}
