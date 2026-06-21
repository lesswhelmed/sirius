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
import type { ScoredPost } from "@repo/research-agent";

import { askMyPosts, type AskPhase } from "@/lib/research/ask";

import { generateText, streamText, tool } from "ai";
import { z } from "zod";

import { draftNotePost, draftUrlPost } from "./curate";
import { isModelReady, withPreparedModel } from "./engine";
import { DEFAULT_TEXT_MODEL_ID } from "./models";
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

// ── Ask-my-posts shared helpers ─────────────────────────────────────────────
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Evenly-spaced sample so the test covers the library, not just the newest rows.
function pickSpread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]!);
}


// ── Ask-my-posts full chat-flow bench ───────────────────────────────────────
// Blackbox test of the EXACT path the chat screen runs: askMyPosts — SEMANTIC
// retrieval (the query is embedded server-side and ranked against the gemini
// vectors synced into the local post_vectors index) followed by a grounded answer.
// Asks natural-language questions derived from REAL synced posts and asserts: the
// asked post is itself retrieved (self-retrieval), the source set stays FOCUSED
// (not a whole-library dump), and an answer streamed — so a failure points at the
// phase that broke. Requires the chat model loaded AND post_vectors populated (run
// a sync first); logs one structured [llm-test] line.
export const ASK_FLOW_FIXTURE = {
  id: "ask-flow",
  label: "Ask my posts (full chat flow)",
};

// Mirror of ask.ts TOP_K — the focused-retrieval bound. A relevant query must
// return a handful of posts, never the whole library.
const EXPECTED_TOP_K = 6;

export async function runAskFlowTest(): Promise<FixtureResult> {
  const start = Date.now();
  const checks: DraftCheck[] = [];
  const finish = (ok: boolean): FixtureResult => {
    const result: FixtureResult = {
      id: ASK_FLOW_FIXTURE.id,
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

  // The whole flow (decide + answer) runs on the chat model. Gate on the SAME
  // signal the chat screen uses — isModelReady(chatModelId) — not canDraftOnDevice:
  // the chat path prepares the model directly and works even when the "Draft on
  // device" curation toggle is off. Skip-as-fail (don't trigger a download) with a
  // clear reason rather than throwing, mirroring the other benches.
  const settings = await getLlmSettings();
  const chatModelId = settings.modelId || DEFAULT_TEXT_MODEL_ID;
  if (!(await isModelReady(chatModelId))) {
    checks.push({
      name: "chat-model-ready",
      pass: false,
      detail: `download the chat model first (${chatModelId})`,
    });
    return finish(false);
  }

  // Real synced posts to phrase questions about (same source as the post-search
  // bench: documents are embedded server-side, vectors arrive via post sync).
  const rows = await db
    .select({
      serverId: postsTable.serverId,
      slug: postsTable.slug,
      title: postsTable.title,
    })
    .from(postsTable)
    .where(
      and(isNotNull(postsTable.serverId), ne(postsTable.syncState, "tombstone")),
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

  // A spread of real posts, phrased as a user would actually ask — not the bare
  // title — so retrieval has to match on meaning the way it does in chat.
  const samples = pickSpread(usable, Math.min(2, usable.length));
  let selfRetrievedCount = 0;
  let maxSources = 0;
  for (const s of samples) {
    const question = `What did I write about "${s.title}"? Summarize it for me.`;
    const phases: AskPhase[] = [];
    // Captured through a container object: a bare `let` assigned only inside the
    // onDecision closure trips TS's closure-narrowing-to-never quirk.
    const captured: {
      decision: { kind: "answer" | "search"; query?: string } | null;
    } = { decision: null };
    let answer = "";
    let sources: ScoredPost[] = [];
    try {
      const res = await askMyPosts({
        chatModelId,
        messages: [{ role: "user", content: question }],
        onPhase: (p) => phases.push(p),
        onDecision: (d) => {
          captured.decision = d;
        },
        onDelta: (d) => {
          answer += d;
        },
      });
      sources = res.sources;
    } catch (err) {
      checks.push({
        name: `ask: ${truncate(s.title, 22)}`,
        pass: false,
        detail: err instanceof Error ? err.message : "askMyPosts threw",
      });
      continue;
    }

    // The crux: did semantic retrieval surface the post the question is ABOUT
    // (self-retrieval), keep the source set focused (not a whole-library dump),
    // and stream an answer?
    const decision = captured.decision;
    const searched = decision?.kind === "search";
    const found = sources.some((p) => p.serverId === s.serverId);
    if (found) selfRetrievedCount++;
    maxSources = Math.max(maxSources, sources.length);
    const focused = sources.length > 0 && sources.length <= EXPECTED_TOP_K;
    const ok = searched && found && focused && answer.trim().length > 0;
    checks.push({
      name: `ask: ${truncate(s.title, 22)}`,
      pass: ok,
      detail:
        `${sources.length} sources` +
        (found ? " (self ✓)" : " (self ✗)") +
        ` · answer ${answer.trim().length}ch`,
    });
  }

  // Aggregate: the asked post must come back (semantic match working) and the set
  // must stay small relative to the library (the old category dump returned all).
  checks.push({
    name: "self-retrieval",
    pass: selfRetrievedCount === samples.length,
    detail: `${selfRetrievedCount}/${samples.length} asked posts were retrieved`,
  });
  checks.push({
    name: "focused-sources",
    pass: maxSources > 0 && maxSources <= EXPECTED_TOP_K,
    detail: `max ${maxSources} sources/query (≤ ${EXPECTED_TOP_K}, library ${usable.length})`,
  });

  return finish(checks.every((c) => c.pass));
}

// ── Phase-0 spike: does Qwen-3B emit structured tool calls on-device? ─────────
// Registers a no-execute tool and a prompt that SHOULD trigger it, then logs
// whether result.toolCalls is populated. Decides full-agentic vs fallback runner.
export async function runToolProbe(): Promise<void> {
  const settings = await getLlmSettings();
  const id = settings.modelId || DEFAULT_TEXT_MODEL_ID;
  if (!(await isModelReady(id))) {
    console.log(
      `[llm-test] ${JSON.stringify({ id: "toolprobe-call", ok: false, detail: `model not ready (${id})` })}`,
    );
    return;
  }
  const searchTool = tool({
    description:
      "Search the user's own saved posts by meaning. Call this whenever the user asks about their own notes or posts.",
    inputSchema: z.object({ query: z.string() }),
  });
  try {
    const r = await withPreparedModel(id, "chat", (model) =>
      generateText({
        model,
        system:
          "You can call tools. Call search_posts whenever the user asks about their own saved posts.",
        messages: [
          { role: "user", content: "What did I save about hiking in Japan?" },
        ],
        tools: { search_posts: searchTool },
      }),
    );
    const calls = r.toolCalls.map((c) => ({ name: c.toolName, input: c.input }));
    console.log(
      `[llm-test] ${JSON.stringify({ id: "toolprobe-call", ok: calls.length > 0, calls, text: r.text.slice(0, 80) })}`,
    );
  } catch (err) {
    console.log(
      `[llm-test] ${JSON.stringify({ id: "toolprobe-call", ok: false, detail: err instanceof Error ? err.message : String(err) })}`,
    );
  }
}

// ── Generation-truncation diagnostic ─────────────────────────────────────────
// Confirms the "first letter only" bug's mechanism: the on-device provider maps
// maxOutputTokens → the native context's n_predict per call, and a prior call
// with a tiny cap can leave that cap on the context so a later UNCAPPED call is
// truncated to one token. Runs three completions on the SAME resident model:
//   1. uncapped baseline      — should be many words
//   2. capped to 1 token      — should be ~1 word (proves the cap path works)
//   3. uncapped again         — MUST be many words; if it is ~1, a stale cap
//                               leaked (the bug). With prewarm no longer running
//                               a capped warm-up, this should pass.
export const GEN_DIAG_FIXTURE = {
  id: "gen-diag",
  label: "Generation isn't truncated (n_predict)",
};

const GEN_PROMPT = "Write three full sentences about why people keep journals.";

export async function runGenDiagnostic(): Promise<FixtureResult> {
  const start = Date.now();
  const checks: DraftCheck[] = [];
  const finish = (ok: boolean): FixtureResult => {
    const result: FixtureResult = {
      id: GEN_DIAG_FIXTURE.id,
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

  const settings = await getLlmSettings();
  const id = settings.modelId || DEFAULT_TEXT_MODEL_ID;
  if (!(await isModelReady(id))) {
    checks.push({
      name: "model-ready",
      pass: false,
      detail: `download the chat model first (${id})`,
    });
    return finish(false);
  }

  const gen = (maxOutputTokens?: number): Promise<string> =>
    withPreparedModel(id, "chat", async (model) => {
      const { textStream } = streamText({
        model,
        prompt: GEN_PROMPT,
        temperature: 0.7,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
      });
      let text = "";
      for await (const delta of textStream) text += delta;
      return text;
    });

  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

  // An explicit cap yields full output.
  const capped256 = await gen(256);
  checks.push({
    name: "explicit-cap-full",
    pass: words(capped256) >= 10,
    detail: `${words(capped256)} words: "${capped256.slice(0, 50)}"`,
  });

  // The cap path works (1 token → ~1 word).
  const capped1 = await gen(1);
  checks.push({
    name: "cap-1-respected",
    pass: words(capped1) <= 3,
    detail: `${words(capped1)} words (expected ~1)`,
  });

  // THE app invariant: an EXPLICIT cap right AFTER a 1-token call still yields
  // full text. Every real call site (answer, selection, drafts) sets
  // maxOutputTokens explicitly precisely because the provider otherwise inherits
  // a stale n_predict — so this must stay green.
  const explicitAfter1 = await gen(800);
  checks.push({
    name: "explicit-cap-after-1tok",
    pass: words(explicitAfter1) >= 10,
    detail: `${words(explicitAfter1)} words: "${explicitAfter1.slice(0, 50)}"`,
  });

  // Platform note (informational, NOT part of our contract): an UNCAPPED call
  // after a 1-token call inherits the stale cap — this is the on-device provider
  // bug we work around by always setting maxOutputTokens. Logged so nobody
  // reintroduces an uncapped generation thinking it's safe.
  const uncappedAfter1 = await gen();
  console.log(
    `[llm-test] ${JSON.stringify({
      id: "gen-diag-platform-note",
      uncappedAfter1Words: words(uncappedAfter1),
      leaks: words(uncappedAfter1) <= 3,
      detail:
        "uncapped-after-1tok inherits the stale n_predict; expected to leak — every real call sets an explicit cap",
    })}`,
  );

  return finish(checks.every((c) => c.pass));
}

// ── Answers clearly about a post ─────────────────────────────────────────────
// The end-to-end guard the user asked for: run the REAL askMyPosts over a real
// synced post and assert the answer is a substantial, grounded response — not the
// single-character "M" regression. Picks a post with a non-empty body, asks about
// it, and checks: the answer is many words (not one char), it's grounded in that
// post (the post is among the cited Sources), and retrieval ran.
export const ANSWER_QUALITY_FIXTURE = {
  id: "answer-quality",
  label: "Answers clearly about a post",
};

export async function runAnswerQualityTest(): Promise<FixtureResult> {
  const start = Date.now();
  const checks: DraftCheck[] = [];
  const finish = (ok: boolean): FixtureResult => {
    const result: FixtureResult = {
      id: ANSWER_QUALITY_FIXTURE.id,
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

  const settings = await getLlmSettings();
  const chatModelId = settings.modelId || DEFAULT_TEXT_MODEL_ID;
  if (!(await isModelReady(chatModelId))) {
    checks.push({
      name: "chat-model-ready",
      pass: false,
      detail: `download the chat model first (${chatModelId})`,
    });
    return finish(false);
  }

  // A real synced post with an actual body to ask about.
  const rows = await db
    .select({
      serverId: postsTable.serverId,
      title: postsTable.title,
      body: postsTable.body,
    })
    .from(postsTable)
    .where(
      and(isNotNull(postsTable.serverId), ne(postsTable.syncState, "tombstone")),
    )
    .limit(500);
  const target = rows.find(
    (r): r is { serverId: string; title: string; body: string } =>
      Boolean(r.serverId) &&
      r.title.trim().length > 0 &&
      Boolean(r.body) &&
      r.body.trim().length > 80,
  );
  checks.push({
    name: "has-a-post",
    pass: Boolean(target),
    detail: target ? `asking about "${target.title}"` : "no synced post w/ body",
  });
  if (!target) return finish(false);

  const question = `Tell me about "${target.title}". What is it about?`;
  let answer = "";
  let sources: ScoredPost[] = [];
  const captured: {
    decision: { kind: "answer" | "search"; query?: string } | null;
  } = { decision: null };
  try {
    const res = await askMyPosts({
      chatModelId,
      messages: [{ role: "user", content: question }],
      onDecision: (d) => {
        captured.decision = d;
      },
      onDelta: (d) => {
        answer += d;
      },
    });
    sources = res.sources;
  } catch (err) {
    checks.push({
      name: "ask-ran",
      pass: false,
      detail: err instanceof Error ? err.message : "askMyPosts threw",
    });
    return finish(false);
  }

  const answerWords = answer.trim().split(/\s+/).filter(Boolean).length;
  // The crux: a real, multi-word answer (the "M"/"[" regression was 1 char).
  checks.push({
    name: "answer-substantive",
    pass: answerWords >= 15,
    detail: `${answerWords} words, ${answer.trim().length} chars: "${answer.slice(0, 60)}"`,
  });
  checks.push({
    name: "grounded-in-post",
    pass: sources.some((p) => p.serverId === target.serverId),
    detail: `${sources.length} sources${sources.some((p) => p.serverId === target.serverId) ? " (target ✓)" : " (target ✗)"}`,
  });
  checks.push({
    name: "retrieval-ran",
    pass: captured.decision?.kind === "search",
    detail: `decision=${captured.decision?.kind ?? "none"}`,
  });

  return finish(checks.every((c) => c.pass));
}
