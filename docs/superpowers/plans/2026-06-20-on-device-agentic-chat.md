# On-device Agentic "Ask my posts" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the on-device "Ask my posts" chat as a stable-prefix agentic tool loop: the Qwen-3B model decides whether to search, opens only the posts that matter, cites only those, and runs fast by reusing the resident model + its KV cache.

**Architecture:** Move retrieved content OUT of the per-turn system prompt and into the message thread as tool results, so the prompt prefix is stable and llama.cpp reuses its KV cache across turns. Give the model two tools it drives itself — `search_posts(query)` returns lightweight candidates (no bodies), `get_post(id)` opens one post's full body — and the Sources UI shows only the posts it opened.

**Tech Stack:** Expo / React Native, `@react-native-ai/llama@0.12` + `llama.rn@0.12.4`, Vercel AI SDK (`ai`), Qwen 2.5 3B Instruct GGUF, Drizzle + expo-sqlite, `@repo/research-agent` (host-agnostic core), Zod 4.

## Global Constraints

- Package manager is **bun**; run from repo root.
- No unit-test runner is wired up in this repo. "Verification" = `turbo check-types --filter=<pkg>`, `turbo lint --filter=<pkg>`, and the dev `/llm-test` bench on the iOS Simulator (structured `[llm-test] {...}` lines in Metro). Do NOT claim unit tests pass.
- `@repo/research-agent` is **host-agnostic**: it must NOT import React Native, Expo, Drizzle, llama.rn, or `@/...`. Platform capabilities are injected via ports/deps only.
- **NEVER use `Output.object` / JSON response_format on-device** — llama.rn 0.12.4 returns an empty completion. Tool-calling is a different path (Qwen `<tool_call>` blocks) — verified in Task 1, not assumed.
- On-device query embedding stays **server-side** (`/api/app/research/embed-query`); the device has no working text encoder. `search_posts` calls the server inside its `execute`.
- The single resident llama context runs one generation at a time — all inference goes through `withPreparedModel(id, "chat", fn)` (engine.ts mutex). Never call `streamText`/`generateText` on a model outside that wrapper.
- Commit per task. Stage only the exact paths listed (the repo runs a multi-agent swarm; never `git add -A`). End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Retrieval knobs (keep as today): `TOP_K = 6`, `MIN_SCORE = 0.25`.

---

## File Structure

**`@repo/research-agent` (host-agnostic core):**
- `packages/research-agent/src/ports.ts` — add `FullPost` interface.
- `packages/research-agent/src/schema.ts` — add `GetPostInputSchema` / `GetPostInput`.
- `packages/research-agent/src/tool.ts` — add `GET_POST_TOOL_NAME`.
- `packages/research-agent/src/prompt.ts` — add `AGENT_SYSTEM_PROMPT`.
- `packages/research-agent/src/ask-agent.ts` — NEW: `runAskAgent` + `AskAgentDeps`/`AskAgentArgs`/`AskAgentRun`/`Candidate`.
- `packages/research-agent/src/index.ts` — export the new symbols.

**`apps/mobile`:**
- `apps/mobile/src/lib/research/tools.ts` — add `fullPostById(id)`; keep `trimExcerpt`.
- `apps/mobile/src/lib/llm/engine.ts` — add `prewarm(modelId)`.
- `apps/mobile/src/lib/research/ask.ts` — rewrite to drive `runAskAgent` with injected `search` / `getPost`.
- `apps/mobile/src/app/llm.tsx` — pre-warm on mount; busy-state mapping (newChat already clears the thread).
- `apps/mobile/src/lib/llm/test-bench.ts` — Task 1 tool-call probe; update `runAskFlowTest` to the new sources contract.
- `apps/mobile/src/app/llm-test.tsx` — wire the `toolprobe` run.

**Dropped vs spec (YAGNI, decided in planning):** no `parts_json` migration, no native `resetContext`. Conversation isolation is the empty message thread; KV reuse is llama.cpp's transparent prefix cache.

---

## Task 1: Phase 0 spike — verify on-device tool-calling

**Goal:** Prove whether Qwen-3B emits structured tool calls through the AI SDK adapter. The outcome selects the runner: Task 5 (full agentic) if it works, Task 8 (fallback) if not. This is dev-bench code, kept permanently as a regression probe.

**Files:**
- Modify: `apps/mobile/src/lib/llm/test-bench.ts`
- Modify: `apps/mobile/src/app/llm-test.tsx`

**Interfaces:**
- Consumes: `withPreparedModel` (engine.ts), `isModelReady`, `getLlmSettings`, `DEFAULT_TEXT_MODEL_ID`.
- Produces: `runToolProbe(): Promise<void>` (logs `[llm-test] {"id":"toolprobe-call",...}`).

- [ ] **Step 1: Add the probe to `test-bench.ts`**

Append to `apps/mobile/src/lib/llm/test-bench.ts` (add `generateText, tool` to the `ai` import and `z` from `zod`, and `withPreparedModel` to the engine import):

```ts
// ── Phase-0 spike: does Qwen-3B emit structured tool calls on-device? ─────────
// Registers a no-execute tool and a prompt that SHOULD trigger it, then logs
// whether result.toolCalls is populated. Decides full-agentic vs fallback runner.
import { generateText, tool } from "ai";
import { z } from "zod";
import { withPreparedModel } from "./engine";

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
```

- [ ] **Step 2: Wire a `toolprobe` run into `llm-test.tsx`**

Find where `llm-test.tsx` dispatches runs by query param (search for `runAskFlowTest` / `?run=`). Add a branch that calls `runToolProbe()` for `run === "toolprobe"`, mirroring the existing run wiring (import `runToolProbe` from `@/lib/llm/test-bench`). Match the file's existing button/effect pattern — do not invent a new UI shape.

- [ ] **Step 3: Type-check**

Run: `turbo check-types --filter=mobile`
Expected: PASS (no type errors).

- [ ] **Step 4: Run the probe on the Simulator**

Per `scripts/testing/MOBILE-E2E.md` and the `mobile-sim-test-workflow` memory, launch the app on the sim with the chat model already downloaded, open `/llm-test?run=toolprobe` (or tap the added button), and read Metro for the line:
`[llm-test] {"id":"toolprobe-call","ok":<bool>,"calls":[...],...}`
Expected: a single structured line. **Record `ok`:** `true` → proceed with Task 5 (full agentic). `false` → still do Tasks 2-4, then Task 8 (fallback) instead of Task 5.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/llm/test-bench.ts apps/mobile/src/app/llm-test.tsx
git commit -m "test(mobile): on-device tool-calling probe (Phase 0 spike)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: research-agent — `FullPost`, `get_post` schema/name, agent prompt

**Goal:** Add the host-agnostic types, the second tool's name + input schema, and the stable agent system prompt. Pure additions; no behavior change yet.

**Files:**
- Modify: `packages/research-agent/src/ports.ts`
- Modify: `packages/research-agent/src/schema.ts`
- Modify: `packages/research-agent/src/tool.ts`
- Modify: `packages/research-agent/src/prompt.ts`

**Interfaces:**
- Produces:
  - `FullPost` = `{ id: string; slug: string; title: string; body: string; excerpt: string | null; tags: string[]; categories: string[]; createdAt: string | null }`
  - `GetPostInputSchema` (zod, `{ id: string }`), `GetPostInput`
  - `GET_POST_TOOL_NAME = "get_post"`
  - `AGENT_SYSTEM_PROMPT: string`

- [ ] **Step 1: Add `FullPost` to `ports.ts`**

Append after the `ScoredPost` interface in `packages/research-agent/src/ports.ts`:

```ts
// A single post opened in full by the agent (get_post tool). Carries the whole
// body + metadata so the model can answer in depth about one post, unlike the
// excerpt-only candidates search_posts returns. `id` is the server id; `slug`
// deep-links the Sources card. `createdAt` is an ISO string (host-formatted) so
// this stays runtime-agnostic.
export interface FullPost {
  id: string;
  slug: string;
  title: string;
  body: string;
  excerpt: string | null;
  tags: string[];
  categories: string[];
  createdAt: string | null;
}
```

- [ ] **Step 2: Add the `get_post` input schema to `schema.ts`**

Append to `packages/research-agent/src/schema.ts`:

```ts
export const GetPostInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      "The id of a post to open in full, taken from a search_posts result.",
    ),
});

export type GetPostInput = z.infer<typeof GetPostInputSchema>;
```

- [ ] **Step 3: Add the tool name to `tool.ts`**

Add to `packages/research-agent/src/tool.ts` (next to `POST_SEARCH_TOOL_NAME`):

```ts
export const GET_POST_TOOL_NAME = "get_post";
```

- [ ] **Step 4: Add `AGENT_SYSTEM_PROMPT` to `prompt.ts`**

Append to `packages/research-agent/src/prompt.ts`:

```ts
// The STABLE system prompt for the agentic ask loop. Unlike buildAnswerSystem
// (which folds retrieved posts into the system message and therefore changes
// every turn), this never changes within a conversation — that stable prefix is
// what lets llama.cpp reuse its KV cache across turns. Retrieved content reaches
// the model only as get_post tool results in the message thread.
export const AGENT_SYSTEM_PROMPT = [
  "You are the user's personal assistant. You have access to the user's private",
  "library of their own saved posts and notes through two tools:",
  "",
  "- search_posts(query): find the user's saved posts by meaning. Returns",
  "  candidates with an id, title, excerpt, and relevance score. Pass a focused",
  "  query distilled from the user's message.",
  "- get_post(id): open ONE candidate and read its full text, tags, and date.",
  "",
  "How to work:",
  "- If the user's message is small talk or general knowledge that does NOT depend",
  "  on their saved posts, just answer. Do not call any tool.",
  "- Otherwise call search_posts with a focused query, then read the candidates.",
  "- Open ONLY the candidates that actually matter with get_post — usually one to",
  "  three. Do not open all of them.",
  "- To mention or cite a specific post, you MUST open it with get_post first; cite",
  "  it by its title. Base every claim about the user's content ONLY on opened",
  "  posts. If nothing relevant is found, say so plainly instead of guessing.",
  "- Be concise and direct.",
].join("\n");
```

- [ ] **Step 5: Type-check + lint**

Run: `turbo check-types --filter=@repo/research-agent && turbo lint --filter=@repo/research-agent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/research-agent/src/ports.ts packages/research-agent/src/schema.ts packages/research-agent/src/tool.ts packages/research-agent/src/prompt.ts
git commit -m "feat(research-agent): FullPost, get_post schema/name, stable agent prompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: research-agent — `runAskAgent` tool loop

**Goal:** The host-agnostic agentic runner: registers `search_posts` + `get_post` with injected executors, loops via `stopWhen`, streams the answer, and reports which posts were opened (the Sources) and whether it searched.

**Files:**
- Create: `packages/research-agent/src/ask-agent.ts`
- Modify: `packages/research-agent/src/index.ts`

**Interfaces:**
- Consumes: `FullPost` (Task 2), `PostSearchInputSchema` + `GetPostInputSchema` (schema.ts), `POST_SEARCH_TOOL_NAME` + `GET_POST_TOOL_NAME` (tool.ts), `AGENT_SYSTEM_PROMPT` (prompt.ts), `ResearchStream` (answer.ts).
- Produces:
  - `Candidate` = `{ id: string; title: string; excerpt: string | null; score: number }`
  - `AskAgentDeps` = `{ llm: LanguageModel; search: (query: string) => Promise<Candidate[]>; getPost: (id: string) => Promise<FullPost | null> }`
  - `AskAgentArgs` = `{ deps: AskAgentDeps; messages: ModelMessage[]; maxSteps?: number; abortSignal?: AbortSignal }`
  - `AskAgentRun` = `{ stream: ResearchStream; opened: FullPost[]; searched: () => boolean }`
  - `runAskAgent(args: AskAgentArgs): AskAgentRun`

- [ ] **Step 1: Create `ask-agent.ts`**

```ts
// The agentic "ask my posts" turn for a single-resident-model host. Unlike
// agent.ts (which assumes two concurrent models for a web client), this runs ONE
// language model and lets it drive retrieval through tools whose executors the
// host injects:
//   - search_posts(query) → deps.search: the host embeds the query (server-side
//     on mobile) and cosine-ranks the local index, returning lightweight
//     candidates (no bodies — the model picks what to open).
//   - get_post(id)        → deps.getPost: the host reads ONE post's full body.
//
// The model decides whether to search at all, which candidates to open, and what
// to cite. `opened` collects exactly the posts it opened (the Sources UI), so a
// post only becomes a source when the agent chose it. The system prompt is stable
// (AGENT_SYSTEM_PROMPT) and retrieved content arrives only as tool results, so the
// prompt prefix stays constant turn to turn — letting llama.cpp reuse its KV cache.
import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  tool,
} from "ai";

import type { ResearchStream } from "./answer";
import type { FullPost } from "./ports";
import { AGENT_SYSTEM_PROMPT } from "./prompt";
import { GetPostInputSchema, PostSearchInputSchema } from "./schema";
import { GET_POST_TOOL_NAME, POST_SEARCH_TOOL_NAME } from "./tool";

// A search hit as the model sees it: enough to decide whether to open the post,
// never its body. `id` feeds get_post.
export interface Candidate {
  id: string;
  title: string;
  excerpt: string | null;
  score: number;
}

export interface AskAgentDeps {
  llm: LanguageModel;
  // Host-side: embed the query + rank the local index → candidates. May return []
  // (nothing matched, or the host swallowed an offline error).
  search: (query: string) => Promise<Candidate[]>;
  // Host-side: read one post's full body + metadata, or null if it's gone.
  getPost: (id: string) => Promise<FullPost | null>;
}

export interface AskAgentArgs {
  deps: AskAgentDeps;
  messages: ModelMessage[];
  // Step cap for the tool loop (search + a few get_posts + the answer). Default 6.
  maxSteps?: number;
  abortSignal?: AbortSignal;
}

export interface AskAgentRun {
  // Consume `.textStream` for the answer tokens.
  stream: ResearchStream;
  // The posts the model OPENED via get_post — the Sources. Fills as the loop runs;
  // read after the stream is fully consumed. De-duplicated by id.
  opened: FullPost[];
  // Whether the model called search_posts at least once (for the dev bench).
  searched: () => boolean;
}

export function runAskAgent(args: AskAgentArgs): AskAgentRun {
  const opened: FullPost[] = [];
  let didSearch = false;

  const searchTool = tool({
    description:
      "Search the user's own saved posts by meaning and return the most relevant " +
      "candidates (id, title, excerpt, score). Call whenever answering needs the " +
      "user's library; pass a focused query.",
    inputSchema: PostSearchInputSchema,
    execute: async ({ query }): Promise<{ posts: Candidate[] }> => {
      didSearch = true;
      return { posts: await args.deps.search(query) };
    },
  });

  const getPostTool = tool({
    description:
      "Open ONE post by id (from a search_posts result) and return its full text, " +
      "tags, and date. Open only the posts that matter to the question.",
    inputSchema: GetPostInputSchema,
    execute: async ({
      id,
    }): Promise<{ post: FullPost } | { error: string }> => {
      const post = await args.deps.getPost(id);
      if (!post) return { error: `no post with id ${id}` };
      if (!opened.some((p) => p.id === post.id)) opened.push(post);
      return { post };
    },
  });

  const stream = streamText({
    model: args.deps.llm,
    system: AGENT_SYSTEM_PROMPT,
    messages: args.messages,
    tools: {
      [POST_SEARCH_TOOL_NAME]: searchTool,
      [GET_POST_TOOL_NAME]: getPostTool,
    },
    stopWhen: stepCountIs(args.maxSteps ?? 6),
    temperature: 0.4,
    abortSignal: args.abortSignal,
  }) as unknown as ResearchStream;

  return { stream, opened, searched: () => didSearch };
}
```

- [ ] **Step 2: Export from `index.ts`**

Add to `packages/research-agent/src/index.ts`:

```ts
export {
  type AskAgentArgs,
  type AskAgentDeps,
  type AskAgentRun,
  type Candidate,
  runAskAgent,
} from "./ask-agent";
```

And add `FullPost` to the existing `export type { ... } from "./ports"` block, and `GetPostInput` / `GetPostInputSchema` to the `from "./schema"` block, and `GET_POST_TOOL_NAME` to the `from "./tool"` block, and `AGENT_SYSTEM_PROMPT` to the `from "./prompt"` block.

- [ ] **Step 3: Type-check + lint**

Run: `turbo check-types --filter=@repo/research-agent && turbo lint --filter=@repo/research-agent`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/research-agent/src/ask-agent.ts packages/research-agent/src/index.ts
git commit -m "feat(research-agent): runAskAgent single-model tool loop

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: mobile — `fullPostById` + `prewarm`

**Goal:** The mobile host primitives the runner needs: read one post's full body+metadata, and warm the resident model on screen open.

**Files:**
- Modify: `apps/mobile/src/lib/research/tools.ts`
- Modify: `apps/mobile/src/lib/llm/engine.ts`

**Interfaces:**
- Consumes: `FullPost` (`@repo/research-agent`), `posts` table (schema.ts), `getPreparedModel` internals via a new wrapper.
- Produces:
  - `fullPostById(id: string): Promise<FullPost | null>` (tools.ts)
  - `prewarm(modelId: string): Promise<void>` (engine.ts)

- [ ] **Step 1: Add `fullPostById` to `tools.ts`**

Append to `apps/mobile/src/lib/research/tools.ts` (add `eq` to the `drizzle-orm` import alongside `inArray`, and import the type):

```ts
import type { FullPost } from "@repo/research-agent";

// Reads ONE post in full for the get_post tool: the whole body (not the BODY_CAP
// slice the old answer context used) plus tags/categories/date, so the agent can
// answer in depth about a single post. Returns null if the post is missing, has no
// slug (can't deep-link), or is empty. Matches on serverId — the id the agent gets
// from a search_posts candidate.
export async function fullPostById(id: string): Promise<FullPost | null> {
  const [row] = await db
    .select({
      serverId: posts.serverId,
      slug: posts.slug,
      title: posts.title,
      body: posts.body,
      excerpt: posts.excerpt,
      tags: posts.tags,
      categories: posts.categories,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(eq(posts.serverId, id))
    .limit(1);
  if (!row || !row.serverId || !row.slug) return null;
  if (!row.body || row.body.trim().length === 0) return null;
  return {
    id: row.serverId,
    slug: row.slug,
    title: row.title,
    body: row.body.trim(),
    excerpt: row.excerpt,
    tags: row.tags ?? [],
    categories: row.categories ?? [],
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}
```

- [ ] **Step 2: Add `prewarm` to `engine.ts`**

Append to `apps/mobile/src/lib/llm/engine.ts` (after `withEmbeddingModel`):

```ts
// Warm the resident model ahead of the first user turn. Runs a 1-token completion
// inside the inference mutex so the context is prepared (loaded + KV initialized)
// before the user sends — the first reply then streams without the cold-load pause.
// Best-effort: any failure (model not ready, bridge missing) is swallowed; the
// real send path surfaces a legible error. No-op cost when already warm: the
// mutex + getPreparedModel short-circuit on the resident model.
export async function prewarm(id: string): Promise<void> {
  try {
    await withPreparedModel(id, "chat", async (model) => {
      const { textStream } = streamText({
        model,
        prompt: "Reply with the single word: ready",
        // A hard ceiling so warm-up can't run away; we only need the prefill.
        maxOutputTokens: 1,
      });
      // Drain so the call completes (and releases the mutex) promptly.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of textStream) break;
    });
  } catch {
    // Warm-up is best-effort; never throw to the screen.
  }
}
```

Add `streamText` to the imports at the top of `engine.ts`:

```ts
import { streamText } from "ai";
```

- [ ] **Step 3: Type-check + lint**

Run: `turbo check-types --filter=mobile && turbo lint --filter=mobile`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/research/tools.ts apps/mobile/src/lib/llm/engine.ts
git commit -m "feat(mobile): fullPostById full-post read + model prewarm

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: mobile — rewrite `ask.ts` to the agentic loop

> **Do this task if Task 1's `toolprobe-call.ok === true`. Otherwise skip to Task 8 (fallback), which produces the same `askMyPosts` signature.**

**Goal:** Replace the always-search-then-dump flow with `runAskAgent`, injecting a server-embed `search` and the local `getPost`. Sources = the posts the model opened.

**Files:**
- Modify: `apps/mobile/src/lib/research/ask.ts`

**Interfaces:**
- Consumes: `runAskAgent`, `AskAgentRun`, `Candidate`, `FullPost`, `ScoredPost`, `searchPosts` (`@repo/research-agent`); `embedQuery` + `EmbedQueryError` (./embed-query); `fullPostById` + `trimExcerpt` (./tools); `sqliteVectorStore`; `withPreparedModel` + `modelBusyBy`.
- Produces: unchanged public signature — `askMyPosts(args): Promise<{ sources: ScoredPost[] }>` with the same `args` (`chatModelId`, `messages`, `onDelta`, `onPhase?`, `onDecision?`, `signal?`). `AskPhase` unchanged.

- [ ] **Step 1: Replace the body of `ask.ts`**

Rewrite `apps/mobile/src/lib/research/ask.ts` to:

```ts
// Query-time "ask my posts" — an AGENTIC turn on the single resident chat model.
// The model drives retrieval through two host-injected tools (see @repo/research-
// agent runAskAgent): search_posts ranks the user's local post index (query
// embedded SERVER-SIDE — the device has no text encoder), get_post opens one
// post's full body. The model decides whether to search, which posts to open, and
// what to cite; Sources are exactly the posts it opened. The system prompt is
// stable and retrieved content arrives as tool results, so the prompt prefix stays
// constant across turns and llama.cpp reuses its KV cache (fast follow-ups).
import {
  type AskAgentRun,
  type Candidate,
  runAskAgent,
  type ScoredPost,
  searchPosts,
} from "@repo/research-agent";
import type { ModelMessage } from "ai";

import { modelBusyBy, withPreparedModel } from "@/lib/llm/engine";

import { embedQuery, EmbedQueryError } from "./embed-query";
import { fullPostById, trimExcerpt } from "./tools";
import { sqliteVectorStore } from "./vector-store";

const TOP_K = 6;
const MIN_SCORE = 0.25;

// Progress phases the UI surfaces. "deciding" = the agent is reading the question
// / choosing tools; "waiting" = a draft holds the single model slot; "searching" =
// a search_posts tool call is running; "answering" = answer tokens are streaming.
export type AskPhase = "deciding" | "waiting" | "searching" | "answering";

export async function askMyPosts(args: {
  chatModelId: string;
  messages: ModelMessage[];
  onDelta: (text: string) => void;
  onPhase?: (phase: AskPhase) => void;
  onDecision?: (decision: { kind: "answer" | "search"; query?: string }) => void;
  signal?: AbortSignal;
}): Promise<{ sources: ScoredPost[] }> {
  // Host executor for search_posts: embed the query server-side, then cosine-rank
  // the local index. On an offline embed failure we record it and return [] so the
  // model can tell the user gracefully rather than the whole turn throwing.
  let offline = false;
  const search = async (query: string): Promise<Candidate[]> => {
    args.onPhase?.("searching");
    try {
      const { vector, modelId } = await embedQuery(query, args.signal);
      const scored = await searchPosts(
        { store: sqliteVectorStore, embeddingModelId: modelId },
        query,
        {
          queryVector: vector,
          topK: TOP_K,
          minScore: MIN_SCORE,
          abortSignal: args.signal,
        },
      );
      return scored.map((p) => ({
        id: p.serverId,
        title: p.title,
        excerpt: trimExcerpt(p.excerpt),
        score: p.score,
      }));
    } catch (err) {
      if (err instanceof EmbedQueryError) {
        offline = true;
        return [];
      }
      throw err;
    }
  };

  args.onPhase?.(modelBusyBy() === "draft" ? "waiting" : "deciding");

  let run: AskAgentRun | null = null;
  let answered = false;
  await withPreparedModel(args.chatModelId, "chat", async (model) => {
    run = runAskAgent({
      deps: { llm: model, search, getPost: fullPostById },
      messages: args.messages,
      abortSignal: args.signal,
    });
    for await (const delta of run.stream.textStream) {
      if (!answered) {
        answered = true;
        args.onPhase?.("answering");
      }
      args.onDelta(delta);
    }
  });

  // If the embed call failed and the model produced nothing useful, say so plainly
  // (semantic search has no offline fallback by design).
  if (offline && !answered) {
    args.onDelta(
      "I couldn't reach the server to search your posts. Check your connection and try again.",
    );
  }

  const opened = run?.opened ?? [];
  const sources: ScoredPost[] = opened.map((p) => ({
    serverId: p.id,
    slug: p.slug,
    title: p.title,
    excerpt: trimExcerpt(p.excerpt),
    // The agent chose these by opening them; score isn't a ranking here.
    score: 1,
  }));
  args.onDecision?.(
    run?.searched() ? { kind: "search" } : { kind: "answer" },
  );
  return { sources };
}
```

- [ ] **Step 2: Type-check + lint**

Run: `turbo check-types --filter=mobile && turbo lint --filter=mobile`
Expected: PASS. (Note: `bodiesByServerIds` in tools.ts may now be unused — if lint flags it as dead, remove it in this commit; the agent reads full bodies via `fullPostById` now.)

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/lib/research/ask.ts apps/mobile/src/lib/research/tools.ts
git commit -m "feat(mobile): agentic ask.ts — model-driven search + get_post

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: mobile — pre-warm on screen open + busy mapping

**Goal:** Warm the model when the chat opens so the first reply isn't cold, and confirm the busy-state mapping still reads well. "New" already clears the thread (sufficient for "new conversation clears memory").

**Files:**
- Modify: `apps/mobile/src/app/llm.tsx`

**Interfaces:**
- Consumes: `prewarm` (engine.ts).

- [ ] **Step 1: Pre-warm in the `Chat` component**

In `apps/mobile/src/app/llm.tsx`, add `prewarm` to the engine import:

```ts
import {
  checkNativeBridge,
  describeLlmError,
  downloadModelById,
  isModelReady,
  modelBusyBy,
  prewarm,
  withPreparedModel,
} from "@/lib/llm/engine";
```

Inside `function Chat({ modelId, modelLabel })`, add an effect that warms once on mount (place it near the `restored` effect):

```ts
  // Warm the resident model on open so the first send streams without the
  // cold-load pause. Best-effort; runs once. Skipped if a draft is mid-flight
  // (it already holds/loads the model).
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current) return;
    warmed.current = true;
    if (modelBusyBy() === null) void prewarm(modelId);
  }, [modelId]);
```

- [ ] **Step 2: Type-check + lint**

Run: `turbo check-types --filter=mobile && turbo lint --filter=mobile`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/llm.tsx
git commit -m "feat(mobile): pre-warm resident model on chat open

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Update the ask-flow bench to the new sources contract + end-to-end verify

**Goal:** The existing `runAskFlowTest` asserts the OLD contract (always-search, `onDecision.kind === "search"`, sources = ranked set). Update it to the agentic contract (sources = opened posts; small talk may not search) and use it to verify the rebuild on the sim.

**Files:**
- Modify: `apps/mobile/src/lib/llm/test-bench.ts`

**Interfaces:**
- Consumes: `askMyPosts` (unchanged signature).

- [ ] **Step 1: Adjust the per-sample assertions in `runAskFlowTest`**

In `apps/mobile/src/lib/llm/test-bench.ts`, the self-retrieval question is `What did I write about "<title>"?` — a library question, so the agent SHOULD search and SHOULD open the asked post. Keep the checks but interpret sources as opened posts:
- `searched` must be `true` (a library question must trigger search_posts).
- `found` = the asked post's `serverId` is among the returned `sources` (now the OPENED posts) — i.e. the agent opened the right post.
- `focused` = `sources.length >= 1 && sources.length <= EXPECTED_TOP_K` (opened set is naturally small — usually 1-3).
The existing check code already expresses this; only update the `focused-sources` comment/detail to say "opened posts" instead of "ranked set", and leave `EXPECTED_TOP_K` as the ceiling. No structural rewrite needed — verify the three checks (`searched`, `found`, `focused`) still hold under the new meaning and adjust wording.

- [ ] **Step 2: Type-check + lint**

Run: `turbo check-types --filter=mobile && turbo lint --filter=mobile`
Expected: PASS.

- [ ] **Step 3: Run the ask-flow bench on the Simulator**

Ensure the chat model is downloaded and a sync has populated `post_vectors` (per the `ask-my-posts-zero-vectors-on-device` memory — empty vectors make retrieval return 0). Open `/llm-test?run=ask`. Read Metro:
`[llm-test] {"id":"ask-flow","ok":true,"checks":[...]}`
Expected: `ok: true`, with `self-retrieval` and `focused-sources` passing.

- [ ] **Step 4: Manual end-to-end on the Simulator** (per `prefer-user-manual-testing` — hand these steps to the user with specific things to report)

Verify each goal against the running app:
1. **Selective sources:** ask a small-talk question ("what's a good word for happy?") → answer streams, **no Sources card**. Ask a library question → Sources show only 1-3 opened posts, not 6.
2. **Single-post depth:** ask "tell me more about my <a real post title> post" → the answer reflects the FULL body (detail beyond the excerpt), Sources shows that one post.
3. **Speed / warmth:** the first reply after opening the screen starts without a long load pause (pre-warm); a follow-up question in the same thread starts faster than a cold first turn (KV reuse).
4. **New conversation clears memory:** tap "New", ask a question that references "the post we just discussed" → the model has no memory of the prior thread.

Report: per item, pass/fail + the first-turn vs follow-up latency you observe, and whether any library question still dumps all 6 posts.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/llm/test-bench.ts
git commit -m "test(mobile): ask-flow bench asserts agentic opened-sources contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 (CONDITIONAL): fallback runner if on-device tool-calling fails Task 1

> **Do this task ONLY if Task 1's `toolprobe-call.ok === false` (the model does not emit reliable tool calls). It replaces Task 5 and produces the identical `askMyPosts` signature, so Tasks 6 & 7 still apply. Tasks 2-4 are still done (their types/prompt/`fullPostById` are reused).**

**Goal:** Achieve "agent chooses sources" without relying on model-initiated tool calls: always run `search_posts`, have the model SELECT relevant candidate ids via a plain-text reply (no tool-calling, no `Output.object`), open those with `fullPostById`, then stream a grounded answer.

**Files:**
- Modify: `apps/mobile/src/lib/research/ask.ts`
- Uses existing `streamResearchAnswer` + `buildAnswerSystem` from `@repo/research-agent`.

**Interfaces:**
- Consumes: `searchPosts`, `streamResearchAnswer`, `ScoredPost` (`@repo/research-agent`); `embedQuery`/`EmbedQueryError`; `fullPostById`/`trimExcerpt`; `withPreparedModel`; `generateText`/`streamText` from `ai`.
- Produces: same `askMyPosts(args)` signature as Task 5.

- [ ] **Step 1: Implement the deterministic select-then-answer flow**

Rewrite `apps/mobile/src/lib/research/ask.ts`:

```ts
// Fallback "ask my posts" for devices where the model does not emit reliable tool
// calls (see the Phase-0 toolprobe). Still "the agent chooses its sources": we
// always run the semantic search, then ask the model — in PLAIN TEXT (no tool
// calls, no Output.object, both of which misbehave on llama.rn 0.12.4) — which
// candidates are relevant. We open only those in full and stream a grounded
// answer. Lean context (only opened bodies) + selective sources, same as the
// agentic path; only the selection mechanism differs.
import {
  buildAnswerSystem,
  type ScoredPost,
  searchPosts,
  streamResearchAnswer,
} from "@repo/research-agent";
import { generateText, type ModelMessage } from "ai";

import { modelBusyBy, withPreparedModel } from "@/lib/llm/engine";

import { embedQuery, EmbedQueryError } from "./embed-query";
import { fullPostById, trimExcerpt } from "./tools";
import { sqliteVectorStore } from "./vector-store";

const TOP_K = 6;
const MIN_SCORE = 0.25;

export type AskPhase = "deciding" | "waiting" | "searching" | "answering";

function lastUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    return m.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ");
  }
  return "";
}

// Parse a comma/space/line separated list of candidate numbers (1-based) out of
// the model's selection reply. "NONE" / no digits → []. Clamps to the candidate
// range and de-dupes.
function parseSelection(text: string, count: number): number[] {
  const nums = (text.match(/\d+/g) ?? [])
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => n >= 1 && n <= count)
    .map((n) => n - 1);
  return [...new Set(nums)];
}

export async function askMyPosts(args: {
  chatModelId: string;
  messages: ModelMessage[];
  onDelta: (text: string) => void;
  onPhase?: (phase: AskPhase) => void;
  onDecision?: (decision: { kind: "answer" | "search"; query?: string }) => void;
  signal?: AbortSignal;
}): Promise<{ sources: ScoredPost[] }> {
  const query = lastUserText(args.messages);

  // 1. Search (no model).
  args.onPhase?.("searching");
  let candidates: ScoredPost[] = [];
  try {
    const { vector, modelId } = await embedQuery(query, args.signal);
    candidates = await searchPosts(
      { store: sqliteVectorStore, embeddingModelId: modelId },
      query,
      { queryVector: vector, topK: TOP_K, minScore: MIN_SCORE, abortSignal: args.signal },
    );
  } catch (err) {
    if (err instanceof EmbedQueryError) {
      args.onDelta(
        "I couldn't reach the server to search your posts. Check your connection and try again.",
      );
      args.onDecision?.({ kind: "answer" });
      return { sources: [] };
    }
    throw err;
  }

  if (candidates.length === 0) {
    // Nothing matched — stream a grounded "couldn't find anything" answer.
    args.onPhase?.(modelBusyBy() === "draft" ? "waiting" : "answering");
    await withPreparedModel(args.chatModelId, "chat", async (model) => {
      args.onPhase?.("answering");
      const { textStream } = streamResearchAnswer({
        llm: model,
        messages: args.messages,
        posts: [],
        abortSignal: args.signal,
      });
      for await (const delta of textStream) args.onDelta(delta);
    });
    args.onDecision?.({ kind: "search", query });
    return { sources: [] };
  }

  // 2. Model SELECTS which candidates matter (plain text), then 3. ANSWER — both
  // under one model slot to avoid re-acquiring the mutex between them.
  args.onPhase?.(modelBusyBy() === "draft" ? "waiting" : "deciding");
  let opened: ScoredPost[] = [];
  await withPreparedModel(args.chatModelId, "chat", async (model) => {
    const list = candidates
      .map((p, i) => `${i + 1}. ${p.title}${p.excerpt ? ` — ${trimExcerpt(p.excerpt)}` : ""}`)
      .join("\n");
    const sel = await generateText({
      model,
      system:
        "You pick which of the user's saved posts are relevant to their question. " +
        "Reply with ONLY the numbers of the relevant posts (comma-separated), or " +
        "NONE. Pick at most three; pick none if none are relevant.",
      messages: [
        ...args.messages,
        { role: "user", content: `Candidate posts:\n${list}` },
      ],
      temperature: 0,
      abortSignal: args.signal,
    });
    const picks = parseSelection(sel.text, candidates.length);
    const chosen = picks.map((i) => candidates[i]!);

    // Open the chosen posts in full; fall back to the candidate excerpt if a body
    // read fails. These full bodies ground the answer.
    const answerPosts: ScoredPost[] = [];
    opened = [];
    for (const c of chosen) {
      const full = await fullPostById(c.serverId);
      opened.push({ ...c, excerpt: trimExcerpt(c.excerpt) });
      answerPosts.push({ ...c, excerpt: full ? full.body : c.excerpt });
    }

    args.onPhase?.("answering");
    const { textStream } = streamResearchAnswer({
      llm: model,
      system: buildAnswerSystem(answerPosts), // note: streamResearchAnswer ignores extra args; see Step 2
      messages: args.messages,
      posts: answerPosts,
      abortSignal: args.signal,
    });
    for await (const delta of textStream) args.onDelta(delta);
  });

  args.onDecision?.({ kind: "search", query });
  return { sources: opened };
}
```

- [ ] **Step 2: Remove the stray `system` arg**

`streamResearchAnswer` builds its own system from `posts` — delete the `system: buildAnswerSystem(answerPosts)` line and the `buildAnswerSystem` import (the `posts: answerPosts` arg already grounds it). It was left in the snippet to make the grounding explicit; remove it so it type-checks.

- [ ] **Step 3: Type-check + lint**

Run: `turbo check-types --filter=mobile && turbo lint --filter=mobile`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/research/ask.ts apps/mobile/src/lib/research/tools.ts
git commit -m "feat(mobile): fallback select-then-answer ask (no on-device tool calls)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- "Agent decides whether to search; sources only when chosen" → Task 3 (`runAskAgent` opened set) / Task 8 (selection). ✓
- "Only load posts that matter, not all results" → `search_posts` returns excerpt-only candidates; only `get_post`/selected posts load full bodies. ✓
- "Single-post deep dive, more than a blurb" → `fullPostById` full body (Task 4), the model opens it (Task 5/8). ✓
- "Keep model running / faster / no reload" → resident singleton (already true) + stable-prefix KV reuse (Task 3/5) + `prewarm` (Task 4/6). ✓
- "Conversation threads with AI SDK" → growing `ModelMessage[]` thread, append-only (Task 5). ✓
- "New conversation clears memory" → empty thread on "New" (already wired in `llm.tsx` `newChat`); documented as sufficient (no native reset). ✓
- "First principles / from the ground up" → retrieved content moved out of the system prompt (the structural fix). ✓
- Phase 0 spike + fallback → Tasks 1 & 8. ✓

**Spec deltas (apply to the spec doc too):** dropped `parts_json` migration and native `resetContext` — both unnecessary (YAGNI), reasoning documented in File Structure and Task 6. The remaining engine change is `prewarm` only.

**Placeholder scan:** none — every code step has full code; verification steps name exact commands + expected output.

**Type consistency:** `FullPost` shape, `Candidate` shape, `AskAgentDeps.search`/`getPost` signatures, and `fullPostById` return type all line up across Tasks 2-5/8; `askMyPosts` signature is identical in Task 5 and Task 8.
