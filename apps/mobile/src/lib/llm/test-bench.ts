// Dev-only blackbox bench for on-device post drafting. Runs the REAL
// pipeline — draftNotePost → inference lock → generateText → generateDraft
// (extractJsonObject → schema) — against a fixed bank of note fixtures, then applies deterministic
// quality checks to the result. No composer, no submission, no server: this
// isolates "does the local model produce a valid, decent post draft" from the
// ingest plumbing (which has its own verified path).
//
// Results print to Metro as one structured line per fixture:
//   [llm-test] {"id":"marina","ok":true,"ms":18234,"checks":[...]}
// so a host-side script (or an agent reading the Metro log) can assert on
// them without touching the UI.
import type { DraftEnvelope } from "@repo/ingest-draft";
import { and, isNotNull, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { posts as postsTable } from "@/lib/db/schema";
import { answerFromPosts, searchMyPosts } from "@/lib/research/ask";
import { buildPostIndex } from "@/lib/research/build-index";
import { sqliteVectorStore } from "@/lib/research/vector-store";

import { canDraftOnDevice, draftNotePost, draftUrlPost } from "./curate";
import { isModelReady } from "./engine";
import { DEFAULT_TEXT_MODEL_ID, EMBEDDING_MODEL_ID } from "./models";
import { getLlmSettings } from "./settings";

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

// Hyphen-separated lowercase groups. Unicode-aware (\p{Ll}/\p{N}) so accented
// lowercase tags like "café" pass — the wire schema accepts them and the worker
// normalizes slugs, so the bench shouldn't flag them as failures.
const KEBAB = /^[\p{Ll}\p{N}]+(-[\p{Ll}\p{N}]+)*$/u;

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
        tags.length >= 1 &&
        tags.length <= 5 &&
        tags.every((t) => KEBAB.test(t)),
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
    })}`,
  );
  return result;
}

// Audio bench: drafts a post from a recorded transcript through the exact
// fixture runner, so the audio path shares the runner/checks/logging with the
// note fixtures (mirrors materials.ts's audio composition: transcript →
// draftNotePost).
export function runTranscriptDraft(transcript: string): Promise<FixtureResult> {
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
  fixture: DraftFixture,
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
    })}`,
  );
  return result;
}

// ── Post search bench ──────────────────────────────────────────────────────
// Blackbox test of the on-device "ask my posts" retrieval against the user's
// REAL synced posts (no fixtures): build the index, then for a spread of sample
// posts confirm that querying each post's own title brings that post back near
// the top — a self-retrieval check that exercises the whole chain (embed → store
// → cosine rank → slug links). When the chat model is also ready it adds a
// best-effort grounded-answer check. Like the draft bench, it logs one
// structured [llm-test] line for host-side / agent assertions.
export const POST_SEARCH_FIXTURE = {
  id: "post-search",
  label: "Post search (your data)",
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Evenly-spaced sample so the test covers the library, not just the newest rows.
function pickSpread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]!);
}

export async function runPostSearchTest(): Promise<FixtureResult> {
  const start = Date.now();
  const checks: DraftCheck[] = [];
  const finish = (ok: boolean): FixtureResult => {
    const result: FixtureResult = {
      id: POST_SEARCH_FIXTURE.id,
      ok,
      ms: Date.now() - start,
      draft: null,
      checks,
    };
    console.log(
      `[llm-test] ${JSON.stringify({
        id: result.id,
        ok: result.ok,
        ms: result.ms,
        checks: checks.map((c) => ({ n: c.name, p: c.pass, d: c.detail })),
      })}`,
    );
    return result;
  };

  // 1. Embedding model present?
  const embedReady = await isModelReady(EMBEDDING_MODEL_ID);
  checks.push({
    name: "embed-model-ready",
    pass: embedReady,
    detail: embedReady ? "downloaded" : "enable post search on /llm first",
  });
  if (!embedReady) return finish(false);

  // 2. Real synced posts to test against.
  const rows = await db
    .select({
      serverId: postsTable.serverId,
      slug: postsTable.slug,
      title: postsTable.title,
    })
    .from(postsTable)
    .where(
      and(
        isNotNull(postsTable.serverId),
        ne(postsTable.syncState, "tombstone"),
      ),
    )
    .limit(500);
  const usable = rows.filter(
    (r): r is { serverId: string; slug: string; title: string } =>
      Boolean(r.serverId) && Boolean(r.slug) && r.title.trim().length > 0,
  );
  checks.push({
    name: "has-posts",
    pass: usable.length > 0,
    detail: `${usable.length} synced posts with a title`,
  });
  if (usable.length === 0) return finish(false);

  // 3. Build/refresh the index, then confirm vectors exist.
  const prog = await buildPostIndex();
  const vectors = await sqliteVectorStore.allVectors(EMBEDDING_MODEL_ID);
  checks.push({
    name: "index-built",
    pass: vectors.length > 0,
    detail: `${vectors.length} vectors (embedded ${prog.done} this run)`,
  });
  if (vectors.length === 0) return finish(false);

  // 4. Self-retrieval over a spread of samples.
  const samples = pickSpread(usable, Math.min(3, usable.length));
  let retrieved = 0;
  let firstResults: Awaited<ReturnType<typeof searchMyPosts>> = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const res = await searchMyPosts(s.title, { topK: 5 });
    if (i === 0) firstResults = res;
    const rank = res.findIndex((r) => r.serverId === s.serverId);
    const hit = rank >= 0;
    if (hit) retrieved++;
    checks.push({
      name: `retrieve: ${truncate(s.title, 24)}`,
      pass: hit,
      detail: hit
        ? `rank #${rank + 1} · score ${res[rank]!.score.toFixed(2)} · ${res.length} hits`
        : `not in top 5 (${res.length} hits)`,
    });
  }
  checks.push({
    name: "self-retrieval",
    pass: retrieved === samples.length,
    detail: `${retrieved}/${samples.length} posts found by their own title`,
  });

  // 5. Result shape: every hit is linkable + scores descending.
  checks.push({
    name: "results-have-links",
    pass: firstResults.length > 0 && firstResults.every((r) => Boolean(r.slug)),
    detail:
      firstResults
        .slice(0, 3)
        .map((r) => r.slug)
        .join(", ") || "no results",
  });
  const sorted = firstResults.every(
    (r, i) => i === 0 || firstResults[i - 1]!.score >= r.score,
  );
  checks.push({
    name: "scores-sorted-desc",
    pass: sorted,
    detail: firstResults.map((r) => r.score.toFixed(2)).join(" ≥ ") || "—",
  });

  // 6. Best-effort: a grounded answer when the chat model is also ready. Skipped
  // (not failed) otherwise so the retrieval test doesn't require the 2GB chat
  // model. Errors are surfaced as a failing check rather than throwing.
  if (firstResults.length > 0 && (await canDraftOnDevice())) {
    try {
      const settings = await getLlmSettings();
      const chatModelId = settings.modelId || DEFAULT_TEXT_MODEL_ID;
      let answer = "";
      await answerFromPosts({
        chatModelId,
        messages: [{ role: "user", content: samples[0]!.title }],
        posts: firstResults,
        onDelta: (d) => {
          answer += d;
        },
      });
      checks.push({
        name: "answer-grounded",
        pass: answer.trim().length > 0,
        detail: truncate(answer.trim(), 60) || "(empty answer)",
      });
    } catch (err) {
      checks.push({
        name: "answer-grounded",
        pass: false,
        detail: err instanceof Error ? err.message : "answer failed",
      });
    }
  }

  return finish(checks.every((c) => c.pass));
}
