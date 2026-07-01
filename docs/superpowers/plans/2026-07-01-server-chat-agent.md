# Server-Side Chat Agent (Gemini Flash) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mobile's weak on-device "ask my posts" chat with a server Gemini Flash 3.5 agent that drives retrieval through tools (the catalog `searchCorpus` + a visibility-gated post read) and streams a grounded, cited answer to the `/llm` screen.

**Architecture:** A session-authed SSE route `POST /api/app/chat` in `apps/web` runs the existing `@repo/research-agent` `runAskAgent` tool loop with a Gemini Flash model injected and its two tools backed by in-process `@repo/db` calls. `search_posts` calls `searchCorpus` (fused FTS + embedding, visibility-gated); a model-settable `includeFriends` flag maps to `scope:"all"` (friends included, strangers excluded because the public catalog is off). `get_post` opens only posts that `search_posts` already surfaced to this viewer (per-request candidate map). Mobile `/llm` becomes a pure online chat: `send()` streams from the route via `expo/fetch`; the on-device engine + drafting stay parked and intact.

**Tech Stack:** Next.js 16 App Router (route handler, hand-rolled SSE per repo convention), Vercel AI SDK `ai` ^6 + `@ai-sdk/google` ^3 (Gemini Flash), `@repo/research-agent` (tool loop), `@repo/db` (`searchCorpus`, `findPostBySlug`, `requireApiKey`), Expo `expo/fetch` streaming on mobile, `bun test` for pure units.

## Global Constraints

- Package manager is **bun** (`bun@1.3.14`). Run commands from repo root unless noted.
- **No `export const dynamic` / `export const runtime`** in any route handler — Next 16 Cache Components rejects them; session-reading handlers are already dynamic.
- Chat model id: **`gemini-3.5-flash`** (matches worker `DEFAULT_MODEL`).
- Retrieval default scope **`mine`**; friends included **only** when the model sets `includeFriends:true` → `searchCorpus` `scope:"all"` with `publicCatalogEnabled` **omitted** (stays false → no stranger content).
- Reuse the existing in-memory limiter `rateLimit(key, max, windowMs)` from `apps/web/lib/rate-limit.ts` (single pm2 process → correct).
- On-device chat is **unhooked, not deleted**: leave `engine.ts`, `curate.ts`, `transcribe*.ts`, `models.ts`, the vector store, and `mirrorPostVector` untouched. `EXPO_PUBLIC_ON_DEVICE_AI` still gates parked drafting; chat no longer depends on it.
- Keep the living doc `docs/llm/LLM-SOURCE-OF-TRUTH.md` in sync (final task). Its §5 anchors A8/A9/A10 flip from absent→present as this lands.
- Prisma `Post` full text field is **`content`** (not `body`). `FullPost.body` (research-agent) is populated from `post.content`.

---

### Task 1: Extend `@repo/research-agent` search tool for friend-scope

**Files:**
- Modify: `packages/research-agent/src/schema.ts` (add `includeFriends` to `PostSearchInputSchema`)
- Modify: `packages/research-agent/src/ask-agent.ts` (thread `includeFriends` through `AskAgentDeps.search` + tool `execute`)
- Modify: `packages/research-agent/src/prompt.ts` (`AGENT_SYSTEM_PROMPT`: when to include friends)
- Test: `packages/research-agent/src/schema.test.ts` (new)

**Interfaces:**
- Produces: `PostSearchInputSchema` now parses `{ query: string; topK?: number; includeFriends?: boolean }` (default `false`).
- Produces: `AskAgentDeps.search: (query: string, opts?: { includeFriends?: boolean }) => Promise<Candidate[]>` (second arg optional — backward compatible with existing callers that ignore it).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Create `packages/research-agent/src/schema.test.ts`:

```ts
import { expect, test } from "bun:test";
import { PostSearchInputSchema } from "./schema";

test("includeFriends defaults to false when omitted", () => {
  const parsed = PostSearchInputSchema.parse({ query: "climbing trips" });
  expect(parsed.includeFriends).toBe(false);
});

test("includeFriends is accepted when the model sets it", () => {
  const parsed = PostSearchInputSchema.parse({
    query: "what did my friends post about coffee",
    includeFriends: true,
  });
  expect(parsed.includeFriends).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/research-agent/src/schema.test.ts`
Expected: FAIL — `includeFriends` is `undefined` (field doesn't exist yet).

- [ ] **Step 3: Add the field to the schema**

In `packages/research-agent/src/schema.ts`, add to the `PostSearchInputSchema` object (after `topK`):

```ts
  includeFriends: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Set true ONLY when the user's question is about their friends' posts " +
        "(e.g. 'what did my friends say about X'). Default false = search only " +
        "the user's own posts.",
    ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/research-agent/src/schema.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Thread `includeFriends` through the ask-agent tool**

In `packages/research-agent/src/ask-agent.ts`:

Change the `AskAgentDeps.search` type:

```ts
  // Host-side: embed the query + rank the index → candidates. `includeFriends`
  // widens the search to the user's friends' shared posts. May return [].
  search: (
    query: string,
    opts?: { includeFriends?: boolean },
  ) => Promise<Candidate[]>;
```

Change the `searchTool` `execute` to forward the flag:

```ts
    execute: async ({ query, includeFriends }): Promise<{ posts: Candidate[] }> => {
      didSearch = true;
      return { posts: await args.deps.search(query, { includeFriends }) };
    },
```

- [ ] **Step 6: Update the agent system prompt**

In `packages/research-agent/src/prompt.ts`, in `AGENT_SYSTEM_PROMPT`, replace the `search_posts` bullet with:

```ts
  "- search_posts(query, includeFriends?): find saved posts by meaning. Returns",
  "  candidates with an id, title, excerpt, and relevance score. Pass a focused",
  "  query distilled from the user's message. Set includeFriends=true ONLY when",
  "  the user is explicitly asking about their friends' posts; otherwise it",
  "  searches only their own library.",
```

- [ ] **Step 7: Verify the package still type-checks**

Run: `bun run --filter=@repo/research-agent check-types` (or `turbo check-types --filter=@repo/research-agent --force`)
Expected: no errors. (Note: force-bust turbo cache — see the turbo-cache-false-pass memory.)

- [ ] **Step 8: Commit**

```bash
git add packages/research-agent/src/schema.ts packages/research-agent/src/ask-agent.ts packages/research-agent/src/prompt.ts packages/research-agent/src/schema.test.ts
git commit -m "feat(research-agent): add includeFriends to search tool for server chat"
```

---

### Task 2: Server chat-agent module (tools wired to Postgres)

**Files:**
- Create: `apps/web/lib/chat/agent.ts` (the model + tool adapters + `runChatTurn`)
- Modify: `apps/web/package.json` (add `ai`, `@ai-sdk/google`, `@repo/research-agent`)
- Test: `apps/web/lib/chat/agent.test.ts` (new — pure adapter tests, no network)

**Interfaces:**
- Consumes: `searchCorpus`, `findPostBySlug`, `requireApiKey` from `@repo/db`; `runAskAgent`, `AskAgentDeps`, `Candidate`, `FullPost` from `@repo/research-agent`.
- Produces:
  - `buildChatDeps(viewerId: string): { deps: AskAgentDeps }` — closes over a fresh per-request candidate map.
  - `hitToCandidate(hit: SearchHit): Candidate` — maps a search hit to a tool candidate.
  - `postToFullPost(post: PostWithRelations): FullPost` — maps a DB row to the tool's full-post shape.
  - `runChatTurn(args: { viewerId: string; messages: ModelMessage[]; abortSignal?: AbortSignal }): AskAgentRun` — the agent run (has `.stream`, `.opened`).

- [ ] **Step 1: Add the dependencies**

In `apps/web/package.json` `dependencies`, add (keep alphabetical with existing `@repo/*`):

```json
    "@ai-sdk/google": "^3.0.73",
    "@repo/research-agent": "*",
    "ai": "^6.0.182",
```

Run: `bun install`
Expected: lockfile updates, no errors.

- [ ] **Step 2: Write the failing adapter tests**

Create `apps/web/lib/chat/agent.test.ts`:

```ts
import { expect, test } from "bun:test";
import { hitToCandidate, postToFullPost } from "./agent";

test("hitToCandidate maps a search hit to a tool candidate", () => {
  const c = hitToCandidate({
    slug: "my-trip",
    title: "My Trip",
    excerpt: null,
    snippet: "a snippet",
    score: 0.42,
    type: "FINDING",
    status: "PUBLISHED",
    categories: [],
    tags: [],
    submittedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    matchReasons: ["exact"],
  } as never);
  expect(c).toEqual({
    id: "my-trip",
    title: "My Trip",
    excerpt: "a snippet",
    score: 0.42,
  });
});

test("postToFullPost uses content as body and names as tag/category strings", () => {
  const full = postToFullPost({
    slug: "my-trip",
    title: "My Trip",
    content: "the full body",
    excerpt: "blurb",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    tags: [{ name: "travel" }],
    categories: [{ name: "life" }],
  } as never);
  expect(full.id).toBe("my-trip");
  expect(full.body).toBe("the full body");
  expect(full.tags).toEqual(["travel"]);
  expect(full.categories).toEqual(["life"]);
  expect(full.createdAt).toBe("2026-01-01T00:00:00.000Z");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test apps/web/lib/chat/agent.test.ts`
Expected: FAIL — cannot find `./agent` / functions not exported.

- [ ] **Step 4: Implement the module**

Create `apps/web/lib/chat/agent.ts`:

```ts
// The server chat agent: Gemini Flash driving the @repo/research-agent tool loop,
// with its two tools backed by in-process @repo/db calls. Owner-scoped to the
// viewer; get_post can only open posts that search_posts already surfaced to
// this viewer (the per-request candidateBySlug map is the visibility gate — a
// candidate is only in it because searchCorpus cleared it).
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  findPostBySlug,
  requireApiKey,
  searchCorpus,
  type PostWithRelations,
  type SearchHit,
} from "@repo/db";
import {
  runAskAgent,
  type AskAgentDeps,
  type AskAgentRun,
  type Candidate,
  type FullPost,
} from "@repo/research-agent";
import type { ModelMessage } from "ai";

const CHAT_MODEL_ID = "gemini-3.5-flash";
// Enough candidates for the model to choose from without bloating the tool result.
const SEARCH_LIMIT = 8;

export function hitToCandidate(hit: SearchHit): Candidate {
  return {
    id: hit.slug,
    title: hit.title,
    excerpt: hit.snippet ?? hit.excerpt,
    score: hit.score,
  };
}

export function postToFullPost(post: PostWithRelations): FullPost {
  return {
    id: post.slug,
    slug: post.slug,
    title: post.title,
    body: post.content,
    excerpt: post.excerpt,
    tags: post.tags.map((t) => t.name),
    categories: post.categories.map((c) => c.name),
    createdAt: post.createdAt ? post.createdAt.toISOString() : null,
  };
}

export function buildChatDeps(viewerId: string): { deps: AskAgentDeps } {
  const google = createGoogleGenerativeAI({ apiKey: requireApiKey() });
  // A candidate is added here only after searchCorpus cleared it for this viewer;
  // get_post refuses any slug not in this set, so the model cannot open a post the
  // viewer can't see (or one it hallucinated).
  const candidateBySlug = new Map<string, true>();

  const search: AskAgentDeps["search"] = async (query, opts) => {
    const page = await searchCorpus(viewerId, query, {
      scope: opts?.includeFriends ? "all" : "mine",
      limit: SEARCH_LIMIT,
      // publicCatalogEnabled intentionally omitted → stays false → no strangers.
    });
    for (const hit of page.items) candidateBySlug.set(hit.slug, true);
    return page.items.map(hitToCandidate);
  };

  const getPost: AskAgentDeps["getPost"] = async (id) => {
    if (!candidateBySlug.has(id)) return null; // not surfaced to this viewer
    const post = await findPostBySlug(id);
    if (!post) return null;
    return postToFullPost(post);
  };

  return { deps: { llm: google(CHAT_MODEL_ID), search, getPost } };
}

export function runChatTurn(args: {
  viewerId: string;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
}): AskAgentRun {
  const { deps } = buildChatDeps(args.viewerId);
  return runAskAgent({
    deps,
    messages: args.messages,
    abortSignal: args.abortSignal,
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test apps/web/lib/chat/agent.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Type-check the web app**

Run: `turbo check-types --filter=web --force`
Expected: no errors. (If `SearchHit`/`PostWithRelations` aren't exported from `@repo/db`, confirm they are re-exported in `packages/db/src/index.ts`; both are per the search/db map. `requireApiKey` is exported from `@repo/db`.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/lib/chat/agent.ts apps/web/lib/chat/agent.test.ts bun.lock
git commit -m "feat(web): server chat agent wiring searchCorpus + get_post to research-agent"
```

---

### Task 3: The SSE route `POST /api/app/chat`

**Files:**
- Create: `apps/web/lib/chat/sse.ts` (pure SSE frame encoder + the message body schema)
- Create: `apps/web/app/api/app/chat/route.ts` (the handler)
- Test: `apps/web/lib/chat/sse.test.ts` (new — pure encoder + schema tests)

**Interfaces:**
- Consumes: `runChatTurn` (Task 2), `getSessionOrNull` (`apps/web/lib/session.ts`), `rateLimit` (`apps/web/lib/rate-limit.ts`).
- Produces:
  - `encodeFrame(event: ChatFrame): string` where `ChatFrame = { t: "token"; v: string } | { t: "sources"; v: ChatSource[] } | { t: "error"; v: string } | { t: "done" }`.
  - `ChatSource = { serverId: string; slug: string; title: string; excerpt: string | null }`.
  - `chatBodySchema` — zod for `{ messages: { role: "user"|"assistant"|"system"; content: string }[] }`.

- [ ] **Step 1: Write the failing encoder/schema tests**

Create `apps/web/lib/chat/sse.test.ts`:

```ts
import { expect, test } from "bun:test";
import { chatBodySchema, encodeFrame } from "./sse";

test("encodeFrame emits one SSE data line with JSON payload", () => {
  expect(encodeFrame({ t: "token", v: "hi" })).toBe(
    `data: ${JSON.stringify({ t: "token", v: "hi" })}\n\n`,
  );
});

test("chatBodySchema rejects an empty message list", () => {
  expect(chatBodySchema.safeParse({ messages: [] }).success).toBe(false);
});

test("chatBodySchema accepts a valid user turn", () => {
  const r = chatBodySchema.safeParse({
    messages: [{ role: "user", content: "hello" }],
  });
  expect(r.success).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/web/lib/chat/sse.test.ts`
Expected: FAIL — cannot find `./sse`.

- [ ] **Step 3: Implement the SSE helpers**

Create `apps/web/lib/chat/sse.ts`:

```ts
// Pure SSE framing + request validation for the chat route. Kept separate from the
// handler so the framing/schema are unit-testable without a session or network.
import { z } from "zod";

export interface ChatSource {
  serverId: string;
  slug: string;
  title: string;
  excerpt: string | null;
}

export type ChatFrame =
  | { t: "token"; v: string }
  | { t: "sources"; v: ChatSource[] }
  | { t: "error"; v: string }
  | { t: "done" };

// One SSE event per frame. The mobile parser splits the stream on the blank line.
export function encodeFrame(event: ChatFrame): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
    )
    .min(1)
    .max(100),
});

export type ChatBody = z.infer<typeof chatBodySchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/web/lib/chat/sse.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Implement the route handler**

Create `apps/web/app/api/app/chat/route.ts`:

```ts
// Session-authed SSE chat: streams a grounded, cited answer over the viewer's own
// posts (and friends' when the model asks). Hand-rolled SSE per repo convention
// (see app/api/app/posts/stream/route.ts). No route-segment config — reading the
// session already makes the handler dynamic (Next 16 Cache Components).
import type { ModelMessage } from "ai";

import { runChatTurn } from "../../../../lib/chat/agent";
import { chatBodySchema, encodeFrame, type ChatSource } from "../../../../lib/chat/sse";
import { rateLimit } from "../../../../lib/rate-limit";
import { getSessionOrNull } from "../../../../lib/session";

// Each chat turn is a paid Gemini call plus tool round-trips — keep caps tight.
const PER_USER_MAX = 30;
const GLOBAL_MAX = 120;
const WINDOW_MS = 5 * 60 * 1000;

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status });
}

export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) return jsonError(401, "unauthorized");

  const perUser = rateLimit(`chat:${session.user.id}`, PER_USER_MAX, WINDOW_MS);
  if (!perUser.ok)
    return jsonError(429, "rate limited", { retryAfterMs: perUser.retryAfterMs });
  const global = rateLimit("chat:global", GLOBAL_MAX, WINDOW_MS);
  if (!global.ok)
    return jsonError(429, "rate limited", { retryAfterMs: global.retryAfterMs });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = chatBodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, "expected { messages: [...] }");

  const messages = parsed.data.messages as ModelMessage[];
  const viewerId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: string) => controller.enqueue(encoder.encode(line));
      try {
        const run = runChatTurn({
          viewerId,
          messages,
          abortSignal: request.signal,
        });
        for await (const delta of run.stream.textStream) {
          send(encodeFrame({ t: "token", v: delta }));
        }
        const sources: ChatSource[] = run.opened.map((p) => ({
          serverId: p.slug,
          slug: p.slug,
          title: p.title,
          excerpt: p.excerpt,
        }));
        send(encodeFrame({ t: "sources", v: sources }));
        send(encodeFrame({ t: "done" }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "chat failed";
        send(encodeFrame({ t: "error", v: msg }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 6: Type-check**

Run: `turbo check-types --filter=web --force`
Expected: no errors.

- [ ] **Step 7: Manual verification (real Gemini + session)**

Start the stack (`bun run dev`), sign in on web, copy the `better-auth` session cookie from the browser devtools, then:

```bash
curl -N https://sirius.local/api/app/chat \
  -H 'content-type: application/json' \
  -H 'cookie: <paste better-auth cookie>' \
  -d '{"messages":[{"role":"user","content":"What have I written about lately?"}]}'
```

Expected: a stream of `data: {"t":"token",...}` lines, then one `data: {"t":"sources",...}` line listing opened posts, then `data: {"t":"done"}`. Unauth (no cookie) → `401 {"error":"unauthorized"}`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/chat/sse.ts apps/web/lib/chat/sse.test.ts apps/web/app/api/app/chat/route.ts
git commit -m "feat(web): session-authed SSE chat route streaming the Gemini agent"
```

---

### Task 4: Mobile streaming client `apiChatStream`

**Files:**
- Create: `apps/mobile/src/lib/research/chat-stream.ts` (the `expo/fetch` streaming client + SSE parser)
- Test: `apps/mobile/src/lib/research/chat-stream.test.ts` (new — pure parser test)

**Interfaces:**
- Consumes: the SSE protocol from Task 3 (`{t:"token"|"sources"|"error"|"done"}`); the auth base URL + session cookie the app already uses (`authBaseURL` + the better-auth expo cookie, same source `apiGet`/`apiPostJson` use via `authClient`).
- Produces:
  - `parseSseChunk(buffer: string): { frames: ChatFrame[]; rest: string }` — pulls complete `data: …\n\n` frames out of a rolling buffer, returns the unparsed remainder.
  - `apiChatStream(args: { messages: {role:string;content:string}[]; onDelta: (t:string)=>void; onSources:(s:ChatSourceDTO[])=>void; signal?: AbortSignal }): Promise<void>` — POSTs to `/api/app/chat`, consumes the stream, invokes callbacks; throws on `{t:"error"}` or transport failure.
  - `ChatSourceDTO = { serverId:string; slug:string; title:string; excerpt:string|null }`.

- [ ] **Step 1: Write the failing parser test**

Create `apps/mobile/src/lib/research/chat-stream.test.ts`:

```ts
import { expect, test } from "bun:test";
import { parseSseChunk } from "./chat-stream";

test("parseSseChunk extracts complete frames and keeps the partial remainder", () => {
  const full =
    `data: ${JSON.stringify({ t: "token", v: "he" })}\n\n` +
    `data: ${JSON.stringify({ t: "token", v: "llo" })}\n\n` +
    `data: {"t":"to`; // partial trailing frame
  const { frames, rest } = parseSseChunk(full);
  expect(frames).toEqual([
    { t: "token", v: "he" },
    { t: "token", v: "llo" },
  ]);
  expect(rest).toBe(`data: {"t":"to`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/mobile/src/lib/research/chat-stream.test.ts`
Expected: FAIL — cannot find `./chat-stream`.

- [ ] **Step 3: Implement the parser + client**

Create `apps/mobile/src/lib/research/chat-stream.ts`:

```ts
// Online chat transport: POST the conversation to the server chat route and stream
// the grounded answer back. Replaces the on-device askMyPosts path — the engine
// stays parked. Uses expo/fetch (streaming ReadableStream on iOS/Android). Auth
// reuses the better-auth expo session cookie the rest of the app sends.
import { fetch as expoFetch } from "expo/fetch";

import { authBaseURL, sessionCookieHeader } from "@/lib/api";

export interface ChatSourceDTO {
  serverId: string;
  slug: string;
  title: string;
  excerpt: string | null;
}

type ChatFrame =
  | { t: "token"; v: string }
  | { t: "sources"; v: ChatSourceDTO[] }
  | { t: "error"; v: string }
  | { t: "done" };

// Pull complete `data: <json>\n\n` frames from a rolling buffer; return the leftover
// partial frame as `rest` so the caller can prepend it to the next chunk.
export function parseSseChunk(buffer: string): {
  frames: ChatFrame[];
  rest: string;
} {
  const frames: ChatFrame[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const line = raw.startsWith("data: ") ? raw.slice(6) : raw;
    if (!line) continue;
    try {
      frames.push(JSON.parse(line) as ChatFrame);
    } catch {
      // ignore a malformed frame rather than killing the stream
    }
  }
  return { frames, rest };
}

export class ChatStreamError extends Error {}

export async function apiChatStream(args: {
  messages: { role: string; content: string }[];
  onDelta: (text: string) => void;
  onSources: (sources: ChatSourceDTO[]) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const res = await expoFetch(`${authBaseURL}/api/app/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...sessionCookieHeader(),
    },
    body: JSON.stringify({ messages: args.messages }),
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    throw new ChatStreamError(`chat request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { frames, rest } = parseSseChunk(buffer);
    buffer = rest;
    for (const f of frames) {
      if (f.t === "token") args.onDelta(f.v);
      else if (f.t === "sources") args.onSources(f.v);
      else if (f.t === "error") throw new ChatStreamError(f.v);
      // "done" ends the stream; the loop exits on reader done.
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/mobile/src/lib/research/chat-stream.test.ts`
Expected: PASS.

- [ ] **Step 5: Export the auth helpers the client needs**

`apiChatStream` needs `authBaseURL` (already in `apps/mobile/src/lib/api.ts`) and a `sessionCookieHeader()` that returns `{ cookie: "<better-auth session cookie>" }` — the same cookie `authClient.$fetch` attaches via `getCookie()`. In `apps/mobile/src/lib/api.ts`, export both:

- Confirm `authBaseURL` is exported (it is referenced in `resolveMediaUrl`); if it's module-private, add `export` to its declaration.
- Add, next to the other exports, using the same better-auth expo cookie source the `$fetch` hook uses:

```ts
import { getCookie } from "@better-auth/expo/client";

// The session cookie the app sends on every API call. expo/fetch (used by the
// chat stream) bypasses authClient.$fetch's hooks, so attach it explicitly —
// same cookie, same jar, no stale-cookie risk (see the toxic-cookie memory).
export function sessionCookieHeader(): Record<string, string> {
  const cookie = getCookie(); // reads the @better-auth/expo stored cookie
  return cookie ? { cookie } : {};
}
```

> **Implementer note:** verify the exact import/signature of the stored-cookie getter against the installed `@better-auth/expo` version — grep `node_modules/@better-auth/expo` for `getCookie` and match how `authClient`'s fetch hook obtains it (the api.ts comment names `getCookie()`). If the app's `authClient` exposes it directly, prefer that. This is the one integration seam to confirm before the manual test in Step 6.

- [ ] **Step 6: Manual verification (device/sim, real server)**

With `bun run dev` up and signed in on the sim, add a temporary dev button (or use the `/llm-test` bench) that calls `apiChatStream({ messages:[{role:"user",content:"summarize my recent posts"}], onDelta: console.log, onSources: console.log })`. Confirm tokens log incrementally and a sources array logs at the end. Remove the temporary button.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/research/chat-stream.ts apps/mobile/src/lib/research/chat-stream.test.ts apps/mobile/src/lib/api.ts
git commit -m "feat(mobile): online chat stream client (expo/fetch + SSE parser)"
```

---

### Task 5: Rewire `/llm` to the online chat (strip on-device chat UI)

**Files:**
- Modify: `apps/mobile/src/app/llm.tsx` (swap `send()`, remove download/model-picker/prewarm/native-bridge gating, online-only states)

**Interfaces:**
- Consumes: `apiChatStream`, `ChatStreamError`, `ChatSourceDTO` (Task 4); existing `createConversation`/`appendMessage`/`deleteConversation` + `ChatSource` type from `apps/mobile/src/lib/db/chat`.
- Produces: nothing downstream.

- [ ] **Step 1: Replace the `send()` body**

In `apps/mobile/src/app/llm.tsx`, replace the `askMyPosts({...})` call inside `send()` (currently lines ~491–516) with the streaming client. Keep the lazy-conversation-create, user-turn persistence, and assistant-turn persistence exactly as they are:

```ts
      setBusy("generating");
      let assistant = "";
      let sources: ChatSource[] = [];
      await apiChatStream({
        messages: modelMessages,
        signal: undefined,
        onDelta: (delta) => {
          assistant += delta;
          setStreamingText(assistant);
        },
        onSources: (s) => {
          sources = s.map((x) => ({
            serverId: x.serverId,
            slug: x.slug,
            title: x.title,
            excerpt: x.excerpt,
          }));
        },
      });
      await appendMessage(convoId, {
        role: "assistant",
        content: assistant,
        sources,
      });
```

Update the `import` block: remove `askMyPosts`/`AskPhase` and `describeLlmError`; add `import { apiChatStream, ChatStreamError } from "@/lib/research/chat-stream";` and keep the `ChatSource` type import from `@/lib/db/chat`. In the `catch`, replace `setError(describeLlmError(err))` with:

```ts
      setError(
        err instanceof ChatStreamError
          ? err.message
          : "You appear to be offline. Chat needs a connection.",
      );
```

- [ ] **Step 2: Simplify the busy states**

The server turn has no on-device "waiting for the drafter" or "deciding" phases. Reduce `setBusy(...)` usage in `send()` to just `"generating"` (set once before the stream; cleared in `finally`). Remove the `"waiting"`/`"deciding"`/`"searching"` branches and any UI copy that references the model slot or a local drafter. Keep a simple "Thinking…" indicator until the first token arrives.

- [ ] **Step 3: Strip the on-device model management UI**

Remove from `LlmScreenInner`/`Chat` (they are on-device-only and now dead):
- the `!ON_DEVICE_AI_ENABLED` early "not available" gate (chat is now always online) — the screen renders the chat directly.
- the download card + `downloadModelById` mutation, `ModelPicker`, `textModels()` usage, `TranscriptionAssets`.
- the `isModelReady`/`checkNativeBridge`/`prewarm(modelId)` calls and the `modelId` plumbing into `send()` (server picks the model).
- the `describeLlmError` import.

Leave the conversation list, history restore, streaming render, Sources card, and composer intact. Leave the dev-only link to `/llm-test`.

> Do NOT touch `engine.ts`, `curate.ts`, `models.ts`, `transcribe*.ts`, the vector store, or `mirrorPostVector`. They stay parked and compiling.

- [ ] **Step 4: Type-check the mobile app**

Run: `turbo check-types --filter=mobile --force`
Expected: no errors. (Fix any now-unused imports the strip left behind.)

- [ ] **Step 5: Manual verification (sim)**

With `bun run dev` up and signed in: open the Explore/Account entry to `/llm`. Confirm there's no download card or model picker — just the chat. Ask "what have I posted about recently?" and confirm the answer streams and Sources appear and deep-link to `/post/[slug]`. Turn on Airplane mode and confirm a clean "you appear to be offline" error, not a crash.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/app/llm.tsx
git commit -m "feat(mobile): /llm is now an online Gemini chat; on-device engine parked"
```

---

### Task 6: Reconcile the living source-of-truth doc

**Files:**
- Modify: `docs/llm/LLM-SOURCE-OF-TRUTH.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Flip statuses**

In `docs/llm/LLM-SOURCE-OF-TRUTH.md`:
- §0 status table: mark "Ask my posts (chat)" as **replaced/removed on-device**; add "Server chat agent" row status **✅ LIVE**.
- §2.2: note the on-device `askMyPosts` chat is now unhooked from `/llm` (code retained but not reachable from the screen), pointing to §3 as the live implementation.
- §3: change the heading from PLANNED to **SHIPPED (v1)**; keep the design as the record.

- [ ] **Step 2: Update the anchors (§5)**

Update the expectations so the loop tracks the new reality:
- A8 `includeFriends` → now `[LIVE]` must be PRESENT (`packages/research-agent/src/schema.ts`).
- A9 `apps/web/app/api/app/chat/route.ts` → now `[LIVE]` must EXIST.
- A10 `@ai-sdk/google` in `apps/web/package.json` → now `[LIVE]` must be PRESENT.
- A12 `/llm` on-device: change to assert the NEW reality — `rg -qn "apiChatStream" apps/mobile/src/app/llm.tsx` PRESENT and `askMyPosts` ABSENT from `llm.tsx`.
- Add A13: server chat module — `rg -qn "runChatTurn" apps/web/lib/chat/agent.ts` PRESENT.

- [ ] **Step 3: Log the decisions/date**

Append to §7 the ship date and bump "Last validated". Add a §6 drift-log entry noting the intended flip (so the next loop tick sees an explained change, not a surprise).

- [ ] **Step 4: Commit**

```bash
git add docs/llm/LLM-SOURCE-OF-TRUTH.md
git commit -m "docs(llm): reconcile source-of-truth after server-chat ship"
```

---

## Self-Review

**Spec coverage (against `docs/llm/LLM-SOURCE-OF-TRUTH.md` §3):**
- §3.1 approach A (in-process agent on web route) → Tasks 2+3. ✅
- §3.2 data flow (Gemini Flash + runAskAgent + searchCorpus + get_post) → Task 2. ✅
- §3.3 retrieval scope (mine default; friends via includeFriends→scope:"all", public off) → Task 1 (flag) + Task 2 (mapping). ✅
- §3.4 shared-agent extension → Task 1. ✅
- §3.5 mobile `/llm` becomes online chat; engine parked → Tasks 4+5. ✅
- §3.6 cost guard (reuse rateLimit) → Task 3. ✅
- §3.7 model + add web AI deps → Task 2 (deps) + Task 2 (`gemini-3.5-flash`). ✅
- §3.8 sources from `run.opened` → Task 3 (sources frame) + Task 5 (persist/render). ✅
- Anchors reconciled → Task 6. ✅

**Placeholder scan:** no TBD/TODO; every code step shows full code; every command has expected output. Two explicit implementer notes (Task 2 Step 6 on `@repo/db` re-exports; Task 4 Step 5 on the exact cookie getter) name the precise thing to confirm rather than hand-waving. ✅

**Type consistency:** `Candidate {id,title,excerpt,score}`, `FullPost {id,slug,title,body,excerpt,tags,categories,createdAt}`, and `AskAgentDeps.search(query, opts?)` match `@repo/research-agent` (Task 1). `ChatSource`/`ChatSourceDTO {serverId,slug,title,excerpt}` are consistent across Tasks 3–5. `ChatFrame` t-values (`token|sources|error|done`) match between `sse.ts` (Task 3) and `chat-stream.ts` (Task 4). `searchCorpus(viewerId, query, {scope,limit})` and `findPostBySlug(slug)` match `@repo/db`. ✅

**Deferred (not in v1, per spec):** web chat UI, richer MCP browse tools (semantic_search/browse_category/classify_text) as agent tools, generative UI, insights dashboards. These are additive on top of the shipped route.
