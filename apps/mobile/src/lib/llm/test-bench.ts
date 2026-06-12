// Dev-only blackbox bench for on-device post drafting. Runs the REAL
// pipeline — draftNotePost → inference lock → generateObject → repairText →
// schema — against a fixed bank of note fixtures, then applies deterministic
// quality checks to the result. No composer, no submission, no server: this
// isolates "does the local model produce a valid, decent post draft" from the
// ingest plumbing (which has its own verified path).
//
// Results print to Metro as one structured line per fixture:
//   [llm-test] {"id":"marina","ok":true,"ms":18234,"checks":[...]}
// so a host-side script (or an agent reading the Metro log) can assert on
// them without touching the UI.
import type { DraftEnvelope } from "@repo/ingest-draft";

import { draftNotePost, draftUrlPost } from "./curate";

export type DraftFixture = { id: string; label: string; notes: string };

// Deliberately diverse: tidy prose, terse fragment, rambling run-on, unicode/
// emoji, and list-style notes — the shapes real captures take.
export const DRAFT_FIXTURES: DraftFixture[] = [
  {
    id: "marina",
    label: "Plain observational note",
    notes:
      "Quiet June evening at the marina. Flat pink water, three pelicans on the dock pilings, the fishing fleet coming in at dusk.",
  },
  {
    id: "terse",
    label: "Terse fragment",
    notes: "First tomatoes off the balcony vine. Small but sweet.",
  },
  {
    id: "rambling",
    label: "Long run-on note",
    notes:
      "Walked the whole seawall before dinner thinking about how the city sounds different in summer, gulls loud over the kelp line, the tide way out past the rocks, two kids racing the ferry wake on scooters, and that bakery on the corner finally reopened after the renovation so the whole block smells like bread again, also I should fix the bike brakes.",
  },
  {
    id: "unicode",
    label: "Emoji + unicode",
    notes:
      "Café day ☕️ — rain on the awning, naïve plan to read 100 pages, managed 12. Watched the crème brûlée torch guy work instead. 🔥",
  },
  {
    id: "list",
    label: "Bullet-style notes",
    notes:
      "- repotted the rosemary\n- roots had circled the pot twice\n- new terracotta pot from the flea market\n- watered everything before the heat",
  },
];

export type DraftCheck = { name: string; pass: boolean; detail: string };

export type FixtureResult = {
  id: string;
  ok: boolean;
  ms: number;
  draft: DraftEnvelope | null;
  checks: DraftCheck[];
};

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Deterministic quality gates, mirroring the drafting prompt's contract.
// Schema validity is already enforced by draftNotePost (null = failed there).
export function qualityChecks(draft: DraftEnvelope): DraftCheck[] {
  const { title, body, tags, categories } = draft.post;
  const words = body.split(/\s+/).filter(Boolean).length;
  return [
    {
      name: "body-words",
      pass: words >= 60 && words <= 350,
      detail: `${words} words (want ~80-300)`,
    },
    {
      name: "no-fences",
      pass: !body.includes("```"),
      detail: body.includes("```") ? "body contains code fences" : "clean",
    },
    {
      name: "no-preamble",
      pass: !/^\s*(here('|’)s|here is|sure[,!]|certainly)/i.test(body),
      detail: body.slice(0, 40),
    },
    {
      name: "no-images-or-urls",
      pass: !/!\[|https?:\/\//.test(body),
      detail: /!\[|https?:\/\//.test(body)
        ? "body embeds image markdown or a URL"
        : "clean",
    },
    {
      name: "tags-kebab",
      pass:
        tags.length >= 1 && tags.length <= 5 && tags.every((t) => KEBAB.test(t)),
      detail: tags.join(", "),
    },
    {
      name: "categories-kebab",
      pass:
        categories.length >= 1 &&
        categories.length <= 3 &&
        categories.every((c) => KEBAB.test(c)),
      detail: categories.join(", "),
    },
    {
      name: "title-sane",
      pass: title.trim().length > 0 && title.length <= 80,
      detail: title,
    },
  ];
}

// URL bench: a canned extract summary (what /api/app/extract would return for
// a typical article) so the GENERATION phase of the URL split is testable
// offline in isolation — same draftUrlPost export the urlHandler uses.
export const URL_EXTRACT_FIXTURE = {
  id: "url-extract",
  label: "URL draft from canned extract",
  summary:
    "The page is a long-form essay arguing that small personal websites are " +
    "quietly coming back. The author tracks three waves: the 2000s blog era, " +
    "the platform consolidation of the 2010s, and a current return driven by " +
    'frustration with feeds. One striking line: "an algorithm is a landlord ' +
    'for your attention." It closes with practical advice — buy a domain, ' +
    "write irregularly, link to other people generously — and a list of " +
    "webrings that have re-formed since 2024.",
};

export async function runUrlDraft(): Promise<FixtureResult> {
  const start = Date.now();
  const draft = await draftUrlPost(URL_EXTRACT_FIXTURE.summary, "");
  const ms = Date.now() - start;
  const checks = draft ? qualityChecks(draft) : [];
  const result: FixtureResult = {
    id: URL_EXTRACT_FIXTURE.id,
    ok: draft !== null && checks.every((c) => c.pass),
    ms,
    draft,
    checks,
  };
  console.log(
    `[llm-test] ${JSON.stringify({
      id: result.id,
      ok: result.ok,
      ms: result.ms,
      draftNull: draft === null,
      engine: draft?.engine ?? null,
      title: draft?.post.title ?? null,
    })}`
  );
  return result;
}

// Audio bench: drafts a post from a recorded transcript through the exact
// fixture runner, so the audio path shares the runner/checks/logging with the
// note fixtures (mirrors materials.ts's audio composition: transcript →
// draftNotePost).
export function runTranscriptDraft(
  transcript: string
): Promise<FixtureResult> {
  return runDraftFixture({
    id: "audio-recording",
    label: "Recorded audio",
    notes: transcript,
  });
}

// Runs one fixture through the real drafting path. A null draft means the
// pipeline soft-failed (model missing, curation off, generation/schema error)
// — the Metro [llm] warn right before this line says which.
export async function runDraftFixture(
  fixture: DraftFixture
): Promise<FixtureResult> {
  const start = Date.now();
  const draft = await draftNotePost(fixture.notes);
  const ms = Date.now() - start;
  const checks = draft ? qualityChecks(draft) : [];
  const result: FixtureResult = {
    id: fixture.id,
    ok: draft !== null && checks.every((c) => c.pass),
    ms,
    draft,
    checks,
  };
  console.log(
    `[llm-test] ${JSON.stringify({
      id: result.id,
      ok: result.ok,
      ms: result.ms,
      draftNull: draft === null,
      checks: checks.map((c) => ({ n: c.name, p: c.pass, d: c.detail })),
      title: draft?.post.title ?? null,
    })}`
  );
  return result;
}
