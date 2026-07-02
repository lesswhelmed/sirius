# Mobile LLM Chat Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the mobile `/llm` chat off the hand-rolled SSE protocol onto the AI SDK 6 standard stack (UI Message Stream on the server, `useChat` on mobile) and rebuild the screen with markdown rendering, tool-activity visibility, stop/retry, a LegendList message list, and a corpus-grounded empty state.

**Architecture:** `POST /api/app/chat` keeps its auth/rate-limits/agent (`runAskAgent` via `runChatTurn`) but responds with `createUIMessageStreamResponse` instead of custom frames; sources stream as a `data-source-posts` part written whenever the agent opens a post, and heavy `get_post` tool outputs are trimmed off the wire by a transform. Mobile consumes it with `@ai-sdk/react` `useChat` + `DefaultChatTransport` over `expo/fetch`; history stays local SQLite but rows now persist full `UIMessage` parts JSON (write-behind sync keyed off `status` transitions). The screen decomposes into `components/chat/*`.

**Tech Stack:** ai `^6.0.187` (installed; do NOT bump to 7), `@ai-sdk/react ^3.0.220` (the ai@6-compatible line — v4 depends on ai@7), `@legendapp/list ^3.3.0` (JS-only, no prebuild), `react-native-enriched-markdown` (already installed — reuse, do NOT add react-native-markdown-display), drizzle + expo-sqlite, zod 4, bun test.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-mobile-llm-chat-modernization-design.md`. Update `docs/llm/LLM-SOURCE-OF-TRUTH.md` in the SAME commit that rewires `llm.tsx` (a background loop validates its anchors).
- Stay on the ai@6 line everywhere. `@ai-sdk/react` must be `^3.x`, never `^4.x`.
- Parked on-device code is untouched: `lib/llm/engine.ts`, `curate.ts`, `models.ts`, `lib/research/ask.ts`, `vector-store.ts`, `embed-query.ts`, `tools.ts`.
- apps/web forbids `export const dynamic`/`runtime` route config (Cache Components) — reading the session keeps the route dynamic.
- Commit ONLY explicit paths (`git commit -- <paths>`, never `git add -A`) — shared-tree swarm rule.
- Trust typecheck/lint only with `--force` (turbo remote-cache false-pass rule).
- Pure test files must not import react-native or expo modules (bun test runs in node).
- There is no store build with the old chat protocol; replacing the route outright is safe. Do not deploy (`bun run deploy`) mid-plan — server and mobile land within one session.

---

### Task 1: Server pure helpers — body schema, text extraction, tool-output trimmer

**Files:**
- Create: `apps/web/lib/chat/ui-stream.ts`
- Create: `apps/web/lib/chat/ui-stream.test.ts`

**Interfaces:**
- Consumes: `UIMessageChunk`, `ModelMessage` types from `ai`; `GET_POST_TOOL_NAME` from `@repo/research-agent`.
- Produces (Task 2 imports all of these):
  - `chatBodySchema` (zod) → `{ id?: string; messages: WireUIMessage[] }` (loose, extras ignored)
  - `toModelMessages(messages: WireUIMessage[]): ModelMessage[]` — text parts only, flattened
  - `makeToolOutputTrimmer(): TransformStream<UIMessageChunk, UIMessageChunk>` — replaces `get_post` outputs with `{ trimmed: true }`
  - `type ChatSource = { serverId: string; slug: string; title: string; excerpt: string | null }`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/chat/ui-stream.test.ts
// bun test for the pure chat-route helpers (schema, text extraction, wire
// trimming). Excluded from tsc like the other bun:test files in this app.
import { describe, expect, test } from "bun:test";
import type { UIMessageChunk } from "ai";

import {
  chatBodySchema,
  makeToolOutputTrimmer,
  toModelMessages,
} from "./ui-stream";

const userMsg = (text: string) => ({
  id: "u1",
  role: "user" as const,
  parts: [{ type: "text", text }],
});

describe("chatBodySchema", () => {
  test("accepts a useChat body and ignores extras", () => {
    const parsed = chatBodySchema.safeParse({
      id: "chat-1",
      trigger: "submit-message",
      messages: [userMsg("hi")],
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects empty messages", () => {
    expect(chatBodySchema.safeParse({ messages: [] }).success).toBe(false);
  });

  test("rejects a message without parts", () => {
    const parsed = chatBodySchema.safeParse({
      messages: [{ id: "u1", role: "user" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("toModelMessages", () => {
  test("keeps only text parts, joins multiples, drops empty messages", () => {
    const messages = [
      userMsg("What did I save about kelp?"),
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          { type: "tool-search_posts", toolCallId: "t1", state: "output-available" },
          { type: "text", text: "You saved" },
          { type: "text", text: "two posts." },
          { type: "data-source-posts", data: [] },
        ],
      },
      { id: "a2", role: "assistant" as const, parts: [{ type: "step-start" }] },
    ];
    expect(toModelMessages(messages as never)).toEqual([
      { role: "user", content: "What did I save about kelp?" },
      { role: "assistant", content: "You saved\n\ntwo posts." },
    ]);
  });
});

async function pump(chunks: UIMessageChunk[]): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const stream = new ReadableStream<UIMessageChunk>({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  }).pipeThrough(makeToolOutputTrimmer());
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("makeToolOutputTrimmer", () => {
  test("trims get_post outputs, leaves search_posts outputs alone", async () => {
    const chunks = [
      { type: "tool-input-start", toolCallId: "s1", toolName: "search_posts" },
      { type: "tool-output-available", toolCallId: "s1", output: { posts: [{ id: "p" }] } },
      { type: "tool-input-start", toolCallId: "g1", toolName: "get_post" },
      { type: "tool-output-available", toolCallId: "g1", output: { post: { body: "HUGE" } } },
      { type: "text-delta", id: "t", delta: "hi" },
    ] as unknown as UIMessageChunk[];
    const out = await pump(chunks);
    expect(out[1]).toMatchObject({ output: { posts: [{ id: "p" }] } });
    expect(out[3]).toMatchObject({ output: { trimmed: true } });
    expect(out[4]).toMatchObject({ type: "text-delta" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/web/lib/chat/ui-stream.test.ts`
Expected: FAIL — `Cannot find module './ui-stream'`

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/chat/ui-stream.ts
// Pure helpers for the UI-message-stream chat route: request validation, text
// extraction for the model, and wire trimming. Kept separate from the handler
// so they are unit-testable without a session or network (bun test).
import { GET_POST_TOOL_NAME } from "@repo/research-agent";
import type { ModelMessage, UIMessageChunk } from "ai";
import { z } from "zod";

// The posts the agent opened — streamed to the client as the
// `data-source-posts` part and rendered as tappable Sources.
export interface ChatSource {
  serverId: string;
  slug: string;
  title: string;
  excerpt: string | null;
}

// Loose validation of the standard useChat request body. Parts are validated
// only as tagged objects — toModelMessages only reads text parts, and unknown
// part types must not reject a request from a newer client.
const wirePartSchema = z.looseObject({ type: z.string() });

const wireMessageSchema = z.looseObject({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(wirePartSchema),
});

export const chatBodySchema = z.looseObject({
  id: z.string().optional(),
  messages: z.array(wireMessageSchema).min(1).max(100),
});

export type WireUIMessage = z.infer<typeof wireMessageSchema>;

// History for the model = the flat text of each turn (matches the pre-migration
// behavior). Tool parts and data parts never replay to the model; a message
// with no text (e.g. an aborted empty turn) is dropped entirely.
export function toModelMessages(messages: WireUIMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    const text = m.parts
      .filter(
        (p): p is { type: "text"; text: string } =>
          p.type === "text" && typeof (p as { text?: unknown }).text === "string",
      )
      .map((p) => p.text)
      .join("\n\n");
    if (text.length === 0) continue;
    out.push({ role: m.role, content: text } as ModelMessage);
  }
  return out;
}

// get_post tool outputs carry FULL post bodies for the model; the client only
// needs the fact that the tool ran (the Sources data part carries the display
// payload). Replace those outputs on the wire so bodies aren't streamed to —
// and persisted on — the device. toolName only appears on the input chunks, so
// track toolCallId → toolName as chunks pass through.
export function makeToolOutputTrimmer(): TransformStream<
  UIMessageChunk,
  UIMessageChunk
> {
  const toolNameById = new Map<string, string>();
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      const c = chunk as { type: string; toolCallId?: string; toolName?: string };
      if (typeof c.toolCallId === "string" && typeof c.toolName === "string") {
        toolNameById.set(c.toolCallId, c.toolName);
      }
      if (
        c.type === "tool-output-available" &&
        typeof c.toolCallId === "string" &&
        toolNameById.get(c.toolCallId) === GET_POST_TOOL_NAME
      ) {
        controller.enqueue({ ...chunk, output: { trimmed: true } } as UIMessageChunk);
        return;
      }
      controller.enqueue(chunk);
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/web/lib/chat/ui-stream.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Verify `GET_POST_TOOL_NAME` is exported from the package root**

Run: `grep -n "tool" packages/research-agent/src/index.ts`
If `./tool` is not re-exported, add `export { GET_POST_TOOL_NAME, POST_SEARCH_TOOL_NAME } from "./tool";` to `packages/research-agent/src/index.ts` (check the file's existing export style first).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/chat/ui-stream.ts apps/web/lib/chat/ui-stream.test.ts packages/research-agent/src/index.ts
git commit -m "feat(web): pure helpers for UI-message-stream chat route" -- apps/web/lib/chat/ui-stream.ts apps/web/lib/chat/ui-stream.test.ts packages/research-agent/src/index.ts
```

---

### Task 2: Server route → UI message stream (+ `onPostOpened` hook in the agent wrapper)

**Files:**
- Modify: `apps/web/lib/chat/agent.ts` (add `onPostOpened` to `buildChatDeps`/`runChatTurn`)
- Modify: `apps/web/app/api/app/chat/route.ts` (replace hand-rolled SSE)
- Delete: `apps/web/lib/chat/sse.ts` (first `grep -rn "chat/sse" apps/web` — the route must be its only importer)

**Interfaces:**
- Consumes: Task 1's `chatBodySchema`, `toModelMessages`, `makeToolOutputTrimmer`, `ChatSource`.
- Produces: `POST /api/app/chat` speaking the standard UI message stream; sources arrive as part `{ type: "data-source-posts", id: "sources", data: ChatSource[] }` (rewritten in place as the agent opens posts). `runChatTurn(args)` gains optional `onPostOpened?: (post: ChatSource) => void`.

- [ ] **Step 1: Thread `onPostOpened` through the agent wrapper**

In `apps/web/lib/chat/agent.ts`, change `buildChatDeps` and `runChatTurn`:

```ts
import type { ChatSource } from "./ui-stream";

export function buildChatDeps(
  viewerId: string,
  onPostOpened?: (post: ChatSource) => void,
): { deps: AskAgentDeps } {
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
    onPostOpened?.({
      serverId: post.slug,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
    });
    return postToFullPost(post);
  };

  return { deps: { llm: google(CHAT_MODEL_ID), search, getPost } };
}

export function runChatTurn(args: {
  viewerId: string;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
  onPostOpened?: (post: ChatSource) => void;
}): AskAgentRun {
  const { deps } = buildChatDeps(args.viewerId, args.onPostOpened);
  return runAskAgent({
    deps,
    messages: args.messages,
    abortSignal: args.abortSignal,
  });
}
```

(`serverId: post.slug` mirrors the old route's `ChatSource` mapping exactly.)

- [ ] **Step 2: Rewrite the route**

```ts
// apps/web/app/api/app/chat/route.ts
// Session-authed chat: streams a grounded, cited answer over the viewer's own
// posts (and friends' when the model asks) as a standard AI SDK UI message
// stream (consumed by useChat on mobile). No route-segment config — reading the
// session already makes the handler dynamic (Next 16 Cache Components).
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import { runChatTurn } from "../../../../lib/chat/agent";
import {
  chatBodySchema,
  makeToolOutputTrimmer,
  toModelMessages,
  type ChatSource,
} from "../../../../lib/chat/ui-stream";
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

  const messages = toModelMessages(parsed.data.messages);
  if (messages.length === 0) return jsonError(400, "no text in messages");
  const viewerId = session.user.id;

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      // Rewrite the same part (stable id) as the agent opens posts, so the
      // client's Sources card fills in live and ends complete.
      const sources: ChatSource[] = [];
      const run = runChatTurn({
        viewerId,
        messages,
        abortSignal: request.signal,
        onPostOpened: (post) => {
          if (sources.some((s) => s.slug === post.slug)) return;
          sources.push(post);
          writer.write({
            type: "data-source-posts",
            id: "sources",
            data: [...sources],
          });
        },
      });
      writer.merge(
        run.stream.toUIMessageStream().pipeThrough(makeToolOutputTrimmer()),
      );
    },
    onError: (err) => (err instanceof Error ? err.message : "chat failed"),
  });

  return createUIMessageStreamResponse({ stream });
}
```

- [ ] **Step 3: Delete the old codec (after confirming the route was its only importer)**

Run: `grep -rn "chat/sse" apps/web/`
Expected: no hits outside the route you just rewrote. Then: `git rm apps/web/lib/chat/sse.ts`

- [ ] **Step 4: Typecheck (force)**

Run: `bun run db:generate && bunx turbo check-types --filter=web --force`
Expected: PASS. If `toUIMessageStream` / chunk types mismatch the installed `ai@6.0.187` d.ts, align with `node_modules/ai/dist/index.d.ts` — the installed types win over this plan.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/chat/agent.ts apps/web/app/api/app/chat/route.ts
git commit -m "feat(web): /api/app/chat speaks the AI SDK UI message stream" -- apps/web/lib/chat/agent.ts apps/web/app/api/app/chat/route.ts apps/web/lib/chat/sse.ts
```

---

### Task 3: Mobile deps, schema migration, and the pure `UIMessage ↔ row` mapping

**Files:**
- Modify: `apps/mobile/package.json` (add `@ai-sdk/react`, `@legendapp/list`)
- Modify: `apps/mobile/src/lib/db/schema.ts` (add `partsJson` to `chat_messages`)
- Generate: `apps/mobile/src/lib/db/migrations/0009_*.sql` (+ journal/`migrations.js`) via drizzle-kit
- Create: `apps/mobile/src/lib/chat/types.ts`
- Create: `apps/mobile/src/lib/chat/message-map.ts`
- Create: `apps/mobile/src/lib/chat/message-map.test.ts`

**Interfaces:**
- Produces (Tasks 4–6 rely on):
  - `type SourcePost = { serverId: string; slug: string; title: string; excerpt: string | null }`
  - `type ChatUIMessage = UIMessage<unknown, { "source-posts": SourcePost[] }>`
  - `rowToUIMessage(row: ChatMessageRow): ChatUIMessage`
  - `uiMessageToRow(msg: ChatUIMessage, conversationId: string, createdAt: Date): NewChatMessageRow`
  - `textOf(msg: ChatUIMessage): string`

- [ ] **Step 1: Add dependencies**

In `apps/mobile/package.json` dependencies (alphabetical order):

```json
"@ai-sdk/react": "^3.0.220",
"@legendapp/list": "^3.3.0",
```

Run: `bun install`
Expected: lockfile updates; both packages resolve. (`@ai-sdk/react@3` pins `ai@6.x` internally — matching the workspace. NEVER `@ai-sdk/react@^4`, it depends on ai@7.)

- [ ] **Step 2: Add the column to the drizzle schema**

In `apps/mobile/src/lib/db/schema.ts`, inside `chatMessages` after `sourcesJson`:

```ts
    // Full UIMessage parts (AI SDK shape: text, tool-*, data-source-posts…),
    // JSON. Null on rows written before the useChat migration — readers fall
    // back to content + sourcesJson (see lib/chat/message-map.ts).
    partsJson: text("parts_json", { mode: "json" }).$type<unknown[] | null>(),
```

(Deliberately `unknown[]` here — schema.ts is consumed by drizzle-kit under node and must not import types from `ai`. The typed view lives in `message-map.ts`.)

- [ ] **Step 3: Generate the migration**

Run: `cd apps/mobile && bunx drizzle-kit generate && cd ../..`
Expected: a new `0009_*.sql` containing `ALTER TABLE \`chat_messages\` ADD \`parts_json\` text;`, plus updated `meta/_journal.json` and `migrations.js`.

- [ ] **Step 4: Write the failing mapping tests**

```ts
// apps/mobile/src/lib/chat/message-map.test.ts
// Pure-module tests (no react-native imports) — runs under plain `bun test`,
// same pattern as nav-dedupe.test.ts.
import { describe, expect, test } from "bun:test";

import type { ChatMessageRow } from "../db/schema";
import { rowToUIMessage, textOf, uiMessageToRow } from "./message-map";
import type { ChatUIMessage } from "./types";

const baseRow: ChatMessageRow = {
  id: "m1",
  conversationId: "c1",
  role: "assistant",
  content: "Hello there.",
  sourcesJson: null,
  partsJson: null,
  createdAt: new Date(1_700_000_000_000),
};

describe("rowToUIMessage", () => {
  test("legacy row → one text part", () => {
    expect(rowToUIMessage(baseRow)).toEqual({
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "Hello there." }],
    });
  });

  test("legacy row with sourcesJson → trailing data-source-posts part", () => {
    const row = {
      ...baseRow,
      sourcesJson: [
        { serverId: "s", slug: "s", title: "T", excerpt: "E", score: 0 },
      ],
    };
    const msg = rowToUIMessage(row as ChatMessageRow);
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts[1]).toEqual({
      type: "data-source-posts",
      id: "sources",
      data: [{ serverId: "s", slug: "s", title: "T", excerpt: "E" }],
    });
  });

  test("partsJson row wins over legacy columns", () => {
    const parts = [{ type: "text", text: "from parts" }];
    const msg = rowToUIMessage({ ...baseRow, partsJson: parts } as ChatMessageRow);
    expect(msg.parts).toEqual(parts);
  });
});

describe("uiMessageToRow / textOf", () => {
  test("round-trips parts and flattens text into content", () => {
    const msg: ChatUIMessage = {
      id: "m2",
      role: "assistant",
      parts: [
        { type: "text", text: "part one" },
        { type: "text", text: "part two" },
      ],
    };
    const row = uiMessageToRow(msg, "c1", new Date(123));
    expect(row).toEqual({
      id: "m2",
      conversationId: "c1",
      role: "assistant",
      content: "part one\n\npart two",
      sourcesJson: null,
      partsJson: msg.parts,
      createdAt: new Date(123),
    });
    expect(textOf(msg)).toBe("part one\n\npart two");
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `bun test apps/mobile/src/lib/chat/message-map.test.ts`
Expected: FAIL — `Cannot find module './message-map'`

- [ ] **Step 6: Implement types + mapping**

```ts
// apps/mobile/src/lib/chat/types.ts
// The chat's typed UIMessage: standard AI SDK message plus our one custom data
// part — the posts the server agent opened (rendered as tappable Sources).
// Mirrors ChatSource in apps/web/lib/chat/ui-stream.ts.
import type { UIMessage } from "ai";

export interface SourcePost {
  serverId: string;
  slug: string;
  title: string;
  excerpt: string | null;
}

export type ChatUIMessage = UIMessage<unknown, { "source-posts": SourcePost[] }>;
```

```ts
// apps/mobile/src/lib/chat/message-map.ts
// Pure UIMessage ↔ chat_messages-row mapping (no react-native imports — unit
// tested under bun). New rows persist full parts JSON; rows written before the
// useChat migration have partsJson null and are reconstructed from the legacy
// content + sourcesJson columns.
import type { ChatMessageRow, NewChatMessageRow } from "../db/schema";
import type { ChatUIMessage, SourcePost } from "./types";

export function textOf(msg: ChatUIMessage): string {
  return msg.parts
    .filter(
      (p): p is Extract<ChatUIMessage["parts"][number], { type: "text" }> =>
        p.type === "text",
    )
    .map((p) => p.text)
    .join("\n\n");
}

export function rowToUIMessage(row: ChatMessageRow): ChatUIMessage {
  if (row.partsJson && Array.isArray(row.partsJson)) {
    return {
      id: row.id,
      role: row.role,
      parts: row.partsJson as ChatUIMessage["parts"],
    };
  }
  const parts: ChatUIMessage["parts"] = [
    { type: "text", text: row.content },
  ];
  if (row.sourcesJson && row.sourcesJson.length > 0) {
    const data: SourcePost[] = row.sourcesJson.map((s) => ({
      serverId: s.serverId,
      slug: s.slug,
      title: s.title,
      excerpt: s.excerpt,
    }));
    parts.push({ type: "data-source-posts", id: "sources", data });
  }
  return { id: row.id, role: row.role, parts };
}

export function uiMessageToRow(
  msg: ChatUIMessage,
  conversationId: string,
  createdAt: Date,
): NewChatMessageRow {
  return {
    id: msg.id,
    conversationId,
    role: msg.role === "user" ? "user" : "assistant",
    content: textOf(msg),
    sourcesJson: null,
    partsJson: msg.parts,
    createdAt,
  };
}
```

Note: `ScoredPost` (the `sourcesJson` element type) has fields `serverId/slug/title/excerpt/score` — check `packages/research-agent/src/ports.ts` if the mapping above doesn't typecheck, and map only the four `SourcePost` fields.

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test apps/mobile/src/lib/chat/message-map.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/package.json bun.lock apps/mobile/src/lib/db/schema.ts apps/mobile/src/lib/db/migrations apps/mobile/src/lib/chat/types.ts apps/mobile/src/lib/chat/message-map.ts apps/mobile/src/lib/chat/message-map.test.ts
git commit -m "feat(mobile): UIMessage persistence schema + pure row mapping" -- apps/mobile/package.json bun.lock apps/mobile/src/lib/db/schema.ts apps/mobile/src/lib/db/migrations apps/mobile/src/lib/chat/types.ts apps/mobile/src/lib/chat/message-map.ts apps/mobile/src/lib/chat/message-map.test.ts
```

---

### Task 4: Mobile transport + rewritten persistence helpers

**Files:**
- Create: `apps/mobile/src/lib/chat/transport.ts`
- Modify: `apps/mobile/src/lib/db/chat.ts` (replace `appendMessage`/`createConversation` with `loadConversationMessages`/`syncConversationMessages`)

**Interfaces:**
- Consumes: Task 3's `ChatUIMessage`, `rowToUIMessage`, `uiMessageToRow`, `textOf`; `authBaseURL`, `sessionCookieHeader` from `@/lib/api`.
- Produces (Tasks 5–6 rely on):
  - `createChatTransport(): DefaultChatTransport<ChatUIMessage>`
  - `streamChatTurn(args: { messages: ChatUIMessage[]; signal?: AbortSignal }): Promise<ChatUIMessage>` (final assistant message — used by the dev bench)
  - `loadConversationMessages(conversationId: string): Promise<ChatUIMessage[]>`
  - `syncConversationMessages(conversationId: string, messages: ChatUIMessage[]): Promise<void>` (replace-all write-behind; creates the conversation row lazily; derives the title from the first user message)
  - `deleteConversation`, `getMostRecentConversationId` (unchanged)

- [ ] **Step 1: Transport module**

```ts
// apps/mobile/src/lib/chat/transport.ts
// The chat's wire layer: a DefaultChatTransport aimed at /api/app/chat over
// expo/fetch (streaming fetch on iOS/Android). Auth reuses the better-auth expo
// session cookie the rest of the app sends (expo/fetch bypasses authClient's
// cookie hook, so it's attached explicitly). Used by the /llm screen (via
// useChat) and the dev bench (via streamChatTurn).
import { DefaultChatTransport, readUIMessageStream } from "ai";
import { randomUUID } from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";

import { authBaseURL, sessionCookieHeader } from "@/lib/api";

import type { ChatUIMessage } from "./types";

export function createChatTransport(): DefaultChatTransport<ChatUIMessage> {
  return new DefaultChatTransport<ChatUIMessage>({
    api: `${authBaseURL}/api/app/chat`,
    fetch: expoFetch as unknown as typeof globalThis.fetch,
    headers: () => sessionCookieHeader(),
  });
}

// One-shot turn for the dev bench: send the messages, consume the UI message
// stream, return the final assistant message snapshot.
export async function streamChatTurn(args: {
  messages: ChatUIMessage[];
  signal?: AbortSignal;
}): Promise<ChatUIMessage> {
  const transport = createChatTransport();
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: randomUUID(),
    messageId: undefined,
    messages: args.messages,
    abortSignal: args.signal,
  });
  let final: ChatUIMessage | undefined;
  for await (const snapshot of readUIMessageStream<ChatUIMessage>({ stream })) {
    final = snapshot;
  }
  if (!final) throw new Error("empty chat stream");
  return final;
}
```

If `sendMessages`'s option object requires more keys under `exactOptionalPropertyTypes`, match the installed `ai@6.0.187` d.ts (`ChatTransport['sendMessages']`) — the installed types win over this plan.

- [ ] **Step 2: Rewrite `apps/mobile/src/lib/db/chat.ts`**

Replace `createConversation` and `appendMessage` with (keep the header comment,
`deriveTitle`, `deleteConversation`, `getMostRecentConversationId` as they are;
delete the now-unused `ScoredPost` import if nothing references it):

```ts
import { asc } from "drizzle-orm";

import { rowToUIMessage, textOf, uiMessageToRow } from "../chat/message-map";
import type { ChatUIMessage } from "../chat/types";

/** All messages of a conversation, oldest first, as typed UIMessages. */
export async function loadConversationMessages(
  conversationId: string,
): Promise<ChatUIMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));
  return rows.map(rowToUIMessage);
}

/**
 * Write-behind persistence for a useChat thread: replace the conversation's
 * rows with the hook's current messages. Replace-all (delete + insert) keeps
 * regenerate/stop simple — the hook state is the truth, rows just mirror it.
 * Creates the conversation row lazily on first write (so an untouched "new
 * chat" never leaves an empty thread behind) and derives the title from the
 * first user message. Row createdAt encodes array order (base + index) so the
 * asc read restores the exact sequence.
 */
export async function syncConversationMessages(
  conversationId: string,
  messages: ChatUIMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  const now = new Date();
  const firstUser = messages.find((m) => m.role === "user");
  const title = firstUser ? deriveTitle(textOf(firstUser)) : null;

  const [existing] = await db
    .select({ id: chatConversations.id, title: chatConversations.title })
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1);

  if (!existing) {
    await db.insert(chatConversations).values({
      id: conversationId,
      title,
      mode: "ask",
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(chatConversations)
      .set({ updatedAt: now, ...(existing.title ? {} : { title }) })
      .where(eq(chatConversations.id, conversationId));
  }

  await db
    .delete(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId));
  await db
    .insert(chatMessages)
    .values(
      messages.map((m, i) =>
        uiMessageToRow(m, conversationId, new Date(now.getTime() + i)),
      ),
    );
}
```

- [ ] **Step 3: Confirm nothing else imports the removed helpers**

Run: `grep -rn "appendMessage\|createConversation" apps/mobile/src/`
Expected: only `llm.tsx` (rewritten in Task 5) and `db/chat.ts` itself. If the old `llm.tsx` still references them, that's fine — it is replaced next task; do NOT run check-types until Task 5.

- [ ] **Step 4: Run the pure tests still green**

Run: `bun test apps/mobile/src/lib/chat/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/chat/transport.ts apps/mobile/src/lib/db/chat.ts
git commit -m "feat(mobile): chat transport (DefaultChatTransport/expo-fetch) + UIMessage persistence" -- apps/mobile/src/lib/chat/transport.ts apps/mobile/src/lib/db/chat.ts
```

---

### Task 5: The new `/llm` UI — components/chat/* + screen rewrite

**Files:**
- Create: `apps/mobile/src/components/chat/chat-markdown.tsx`
- Create: `apps/mobile/src/components/chat/message-bubble.tsx`
- Create: `apps/mobile/src/components/chat/sources-card.tsx`
- Create: `apps/mobile/src/components/chat/chat-composer.tsx`
- Create: `apps/mobile/src/components/chat/chat-empty-state.tsx`
- Create: `apps/mobile/src/components/chat/chats-modal.tsx` (moved from llm.tsx)
- Rewrite: `apps/mobile/src/app/llm.tsx`

**Interfaces:**
- Consumes: Task 3 `ChatUIMessage`/`SourcePost`/`textOf`, Task 4 `createChatTransport`/`loadConversationMessages`/`syncConversationMessages`; `useChat` from `@ai-sdk/react`; `LegendList` from `@legendapp/list`; `EnrichedMarkdownText` (style map adapted from `components/post-markdown.tsx`); `openPost`, `pushOnce` from `@/lib/nav`; theme via `useTheme`/`useThemedStyles`; `KeyboardDoneButton`, `MetaText`, `Screen`, `TextLink` from `@/components/sirius`; `setStringAsync` from `expo-clipboard`; local mirror `posts` table for empty-state chips.
- Produces: the working screen. No exports consumed by later tasks.

- [ ] **Step 1: Chat-scale markdown renderer**

`chat-markdown.tsx`: copy `makeMarkdownStyle` + `handleLinkPress` + the `SERIF`/`MONO`/`MD4C_FLAGS` constants from `components/post-markdown.tsx`, then shrink to bubble scale: paragraph/list `fontSize: 15, lineHeight: 22, marginBottom: t.space.sm`; h1→`fontSize: 20, lineHeight: 24`, h2→18/22, h3→16/21 (all `marginTop: t.space.sm, marginBottom: t.space.xs`); code/codeBlock `fontSize: 13`; keep link/strong/em/blockquote/table colors identical. Export:

```tsx
export function ChatMarkdown({ markdown }: { markdown: string }) {
  const t = useTheme();
  const markdownStyle = useMemo(() => makeChatMarkdownStyle(t), [t]);
  return (
    <EnrichedMarkdownText
      markdown={markdown}
      flavor="github"
      md4cFlags={MD4C_FLAGS}
      markdownStyle={markdownStyle}
      onLinkPress={handleLinkPress}
    />
  );
}
```

Add a header comment noting it's the chat-scale sibling of `post-markdown.tsx` (kept separate: post scale is editorial 17pt, chat is conversational 15pt).

- [ ] **Step 2: Sources card** (`sources-card.tsx` — port of the old `Sources` component, typed on `SourcePost`)

```tsx
// The cited posts under an answer. Each taps through to the post detail screen.
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MetaText } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";
import type { SourcePost } from "@/lib/chat/types";
import { openPost } from "@/lib/nav";

export function SourcesCard({ posts }: { posts: SourcePost[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sources}>
      <MetaText style={styles.sourcesEyebrow}>Sources</MetaText>
      {posts.map((p, i) => (
        <Pressable
          key={p.serverId}
          style={styles.sourceCard}
          onPress={() => openPost(p.slug, "Chat")}
          accessibilityRole="button"
          accessibilityLabel={`Open ${p.title}`}
        >
          <Text style={styles.sourceTitle} numberOfLines={1}>
            {i + 1}. {p.title}
          </Text>
          {p.excerpt ? (
            <Text style={styles.sourceExcerpt} numberOfLines={2}>
              {p.excerpt}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    sources: { alignSelf: "flex-start", gap: 6, maxWidth: "92%" },
    sourcesEyebrow: { textTransform: "uppercase" },
    sourceCard: {
      backgroundColor: t.color.paperSunken,
      borderRadius: 8,
      gap: 2,
      padding: 10,
    },
    sourceTitle: { color: t.color.ink, fontSize: 14, fontWeight: "600" },
    sourceExcerpt: { color: t.color.inkMuted, fontSize: 12, lineHeight: 17 },
  });
}
```

- [ ] **Step 3: Message bubble** (`message-bubble.tsx`)

Renders one `ChatUIMessage` part-by-part. Long-press copies the text. Tool parts render as an activity line; while a tool part's `state` is not `output-available`/`output-error` it shows a spinner.

```tsx
// One chat turn: user bubbles are solid ink; assistant turns render their parts
// in order — markdown text, tool-activity lines ("Searching your posts…"), and
// the Sources card from the data-source-posts part. Long-press copies the text.
import { setStringAsync } from "expo-clipboard";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { MetaText } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { textOf } from "@/lib/chat/message-map";
import type { ChatUIMessage } from "@/lib/chat/types";

import { ChatMarkdown } from "./chat-markdown";
import { SourcesCard } from "./sources-card";

type Part = ChatUIMessage["parts"][number];

function toolActivityLabel(part: Part): string | null {
  if (part.type === "tool-search_posts") {
    const query =
      part.state === "input-available" || part.state === "output-available"
        ? (part.input as { query?: string } | undefined)?.query
        : undefined;
    return query ? `Searching your posts — “${query}”` : "Searching your posts…";
  }
  if (part.type === "tool-get_post") return "Reading a post…";
  return null;
}

function toolIsRunning(part: Part): boolean {
  const state = (part as { state?: string }).state;
  return state !== "output-available" && state !== "output-error";
}

export function MessageBubble({
  message,
  streaming,
}: {
  message: ChatUIMessage;
  streaming: boolean;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (message.role === "user") {
    return (
      <Pressable
        style={[styles.bubble, styles.bubbleUser]}
        onLongPress={() => void setStringAsync(textOf(message))}
        accessibilityHint="Long-press to copy"
      >
        <Text style={styles.bubbleUserText}>{textOf(message)}</Text>
      </Pressable>
    );
  }

  const hasText = message.parts.some(
    (p) => p.type === "text" && p.text.length > 0,
  );

  return (
    <View style={styles.msgGroup}>
      {message.parts.map((part, i) => {
        if (part.type === "text" && part.text.length > 0) {
          return (
            <Pressable
              key={i}
              style={[styles.bubble, styles.bubbleModel]}
              onLongPress={() => void setStringAsync(textOf(message))}
              accessibilityHint="Long-press to copy"
            >
              <ChatMarkdown markdown={part.text} />
            </Pressable>
          );
        }
        const activity = toolActivityLabel(part);
        if (activity) {
          const running = streaming && toolIsRunning(part);
          return (
            <View key={i} style={styles.activityRow}>
              {running ? (
                <ActivityIndicator size="small" color={t.color.inkMuted} />
              ) : null}
              <MetaText style={styles.activityText}>{activity}</MetaText>
            </View>
          );
        }
        if (part.type === "data-source-posts" && part.data.length > 0) {
          return <SourcesCard key={i} posts={part.data} />;
        }
        return null;
      })}
      {!hasText && streaming ? (
        <View style={[styles.bubble, styles.bubbleModel]}>
          <Text style={styles.thinking}>Thinking…</Text>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    msgGroup: { gap: 6 },
    bubble: { borderRadius: 10, maxWidth: "88%", padding: 12 },
    bubbleUser: { alignSelf: "flex-end", backgroundColor: t.color.ink },
    bubbleModel: { alignSelf: "flex-start", backgroundColor: t.color.paperRaised },
    bubbleUserText: { color: t.color.paper, fontSize: 15, lineHeight: 21 },
    thinking: { color: t.color.inkMuted, fontSize: 15, lineHeight: 21 },
    activityRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
      paddingLeft: 4,
    },
    activityText: { color: t.color.inkMuted },
  });
}
```

- [ ] **Step 4: Composer** (`chat-composer.tsx`)

Editable while streaming; the action button is Send when idle, Stop while `submitted`/`streaming`.

```tsx
// The message input row. Unlike the old screen the input stays editable while
// the assistant streams — the action button flips to Stop instead of locking
// the keyboard away.
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardDoneButton } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";

export function ChatComposer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    onSend(text);
  };

  return (
    <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="Ask about your posts…"
        placeholderTextColor={t.color.inkSubtle}
        accessibilityLabel="Message"
        multiline
      />
      <View style={styles.sendCol}>
        <KeyboardDoneButton />
        {busy ? (
          <Pressable
            style={[styles.sendBtn, styles.stopBtn]}
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel="Stop generating"
          >
            <Text style={styles.sendLabel}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.sendBtn}
            onPress={handleSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Text style={styles.sendLabel}>Send</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    inputRow: {
      alignItems: "flex-end",
      flexDirection: "row",
      gap: 8,
      paddingTop: 8,
    },
    input: {
      backgroundColor: t.color.paperRaised,
      borderRadius: 10,
      color: t.color.ink,
      flex: 1,
      fontSize: 15,
      maxHeight: 120,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    sendCol: { alignItems: "stretch", gap: 6 },
    sendBtn: {
      alignItems: "center",
      backgroundColor: t.color.ink,
      borderRadius: 10,
      justifyContent: "center",
      minWidth: 64,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    stopBtn: { backgroundColor: t.color.danger },
    sendLabel: { color: t.color.paper, fontSize: 14, fontWeight: "600" },
  });
}
```

- [ ] **Step 5: Empty state with corpus-grounded starter chips** (`chat-empty-state.tsx`)

```tsx
// First-open state: what this screen is, plus tappable starter prompts — two
// canned questions and up to two seeded from the user's most recent synced
// posts (local mirror query; no network).
import { desc, isNotNull, ne } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { and } from "drizzle-orm";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MetaText, TextLink } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";
import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import { pushOnce } from "@/lib/nav";

const CANNED = [
  "What themes show up in my recent posts?",
  "Summarize what I saved this week.",
];

export function ChatEmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { data: recent } = useLiveQuery(
    db
      .select({ title: posts.title })
      .from(posts)
      .where(and(isNotNull(posts.serverId), ne(posts.title, "")))
      .orderBy(desc(posts.createdAt))
      .limit(2),
  );

  const chips = [
    ...CANNED,
    ...(recent ?? []).map((p) => `What did I save about “${p.title}”?`),
  ];

  return (
    <View style={styles.empty}>
      <MetaText style={styles.eyebrow}>Ask your posts</MetaText>
      <Text style={styles.detail}>
        Ask anything about your own posts. Answers are grounded in your library
        and link back to the sources.
      </Text>
      <View style={styles.chips}>
        {chips.map((c) => (
          <Pressable
            key={c}
            style={styles.chip}
            onPress={() => onPick(c)}
            accessibilityRole="button"
            accessibilityLabel={c}
          >
            <Text style={styles.chipText} numberOfLines={2}>
              {c}
            </Text>
          </Pressable>
        ))}
      </View>
      {__DEV__ ? (
        <TextLink label="Draft test bench →" onPress={() => pushOnce("/llm-test")} />
      ) : null}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    empty: { gap: 12, paddingTop: 32 },
    eyebrow: { textTransform: "uppercase" },
    detail: { color: t.color.inkMuted, fontSize: 14, lineHeight: 20 },
    chips: { gap: 8, marginTop: 4 },
    chip: {
      backgroundColor: t.color.paperRaised,
      borderRadius: 10,
      padding: 12,
    },
    chipText: { color: t.color.ink, fontSize: 14, lineHeight: 19 },
  });
}
```

- [ ] **Step 6: Chats modal** (`chats-modal.tsx`)

Move the existing `ChatsModal` component + its style entries out of `llm.tsx` verbatim into `components/chat/chats-modal.tsx` (imports: `Modal/Pressable/ScrollView/StyleSheet/Text/View` from react-native, `desc` + `useLiveQuery` + `db` + `chatConversations`, `Screen`, theme hooks). Keep props `{ visible, activeId, onSelect, onDelete, onClose }` and behavior identical; export as `ChatsModal`.

- [ ] **Step 7: Rewrite the screen** (`apps/mobile/src/app/llm.tsx`)

```tsx
// Online chat screen: ask questions grounded in the user's own posts. The
// server (`/api/app/chat`) retrieves and streams over the AI SDK UI message
// stream; this screen renders it with useChat and mirrors each settled turn
// into local SQLite (history is local-only; see `@/lib/db/chat`). The
// on-device engine (llama.rn) stays parked.
import { useChat } from "@ai-sdk/react";
import { LegendList } from "@legendapp/list";
import { randomUUID } from "expo-crypto";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { ChatsModal } from "@/components/chat/chats-modal";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Screen } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import {
  deleteConversation,
  getMostRecentConversationId,
  loadConversationMessages,
  syncConversationMessages,
} from "@/lib/db/chat";
import { createChatTransport } from "@/lib/chat/transport";
import type { ChatUIMessage } from "@/lib/chat/types";

export default function LlmScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  // The active thread id. A fresh UUID = a new (not-yet-persisted) chat — the
  // conversation row is created lazily by syncConversationMessages on the
  // first settled write, so abandoned empty chats never hit the DB.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Messages restored from SQLite for the active thread; null while loading.
  const [initial, setInitial] = useState<ChatUIMessage[] | null>(null);
  const [chatsOpen, setChatsOpen] = useState(false);

  // Restore the most recent conversation once on mount (or start fresh).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      const id = await getMostRecentConversationId();
      if (id) {
        setInitial(await loadConversationMessages(id));
        setConversationId(id);
      } else {
        setInitial([]);
        setConversationId(randomUUID());
      }
    })();
  }, []);

  const openConversation = async (id: string) => {
    setInitial(null);
    setChatsOpen(false);
    setInitial(await loadConversationMessages(id));
    setConversationId(id);
  };

  const newChat = () => {
    setInitial([]);
    setConversationId(randomUUID());
  };

  const handleDelete = (id: string) => {
    if (id === conversationId) newChat();
    void deleteConversation(id);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerBtns}>
              {/* Icon buttons (not words) so the two actions read as distinct
                  taps instead of one cluttered text blob inside iOS 26's grouped
                  header pill. Text fallback covers Android/web (no SF Symbols). */}
              <Pressable
                onPress={newChat}
                accessibilityRole="button"
                accessibilityLabel="New chat"
                hitSlop={8}
              >
                <SymbolView
                  name="square.and.pencil"
                  size={22}
                  weight="semibold"
                  tintColor={t.color.ink}
                  fallback={<Text style={styles.headerAction}>New</Text>}
                />
              </Pressable>
              <Pressable
                onPress={() => setChatsOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Chats"
                hitSlop={8}
              >
                <SymbolView
                  name="list.bullet"
                  size={22}
                  weight="semibold"
                  tintColor={t.color.ink}
                  fallback={<Text style={styles.headerAction}>Chats</Text>}
                />
              </Pressable>
            </View>
          ),
        }}
      />
      {conversationId && initial !== null ? (
        <ChatView key={conversationId} conversationId={conversationId} initial={initial} />
      ) : (
        <Screen style={styles.container} />
      )}
      <ChatsModal
        visible={chatsOpen}
        activeId={conversationId}
        onSelect={(id) => void openConversation(id)}
        onDelete={handleDelete}
        onClose={() => setChatsOpen(false)}
      />
    </>
  );
}

// One mounted thread. Keyed by conversationId in the parent so switching
// threads re-instantiates useChat with that thread's restored messages.
function ChatView({
  conversationId,
  initial,
}: {
  conversationId: string;
  initial: ChatUIMessage[];
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Native nav header height: safe-area top + the iOS nav bar. Derived, not
  // hardcoded, so KeyboardAvoidingView is right on notch/Dynamic Island devices.
  const headerHeight = insets.top + 44;
  const transport = useMemo(() => createChatTransport(), []);

  const { messages, sendMessage, status, stop, error, regenerate } =
    useChat<ChatUIMessage>({
      id: conversationId,
      messages: initial,
      transport,
    });

  const busy = status === "submitted" || status === "streaming";

  // Write-behind persistence: mirror the hook's messages into SQLite whenever a
  // turn settles (user turn lands at "submitted"; the assistant turn at
  // "ready"/"error" — including partial text after Stop). Replace-all keeps
  // regenerate consistent. The screen never reads these rows while mounted.
  useEffect(() => {
    if (status === "streaming" || messages.length === 0) return;
    void syncConversationMessages(conversationId, messages);
  }, [status, messages, conversationId]);

  // Abort the stream if the user leaves the screen mid-generation.
  useEffect(() => () => stop(), [stop]);

  const lastId = messages[messages.length - 1]?.id;

  return (
    <Screen style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
      >
        {messages.length === 0 ? (
          <View style={styles.flex}>
            <ChatEmptyState onPick={(text) => void sendMessage({ text })} />
          </View>
        ) : (
          <LegendList
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                streaming={busy && item.id === lastId}
              />
            )}
            contentContainerStyle={styles.messages}
            alignItemsAtEnd
            maintainScrollAtEnd
            maintainScrollAtEndThreshold={0.15}
            maintainVisibleContentPosition
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          />
        )}
        {error ? (
          <View style={styles.errorRow}>
            <Text style={styles.error}>{friendlyError(error)}</Text>
            <Pressable
              onPress={() => void regenerate()}
              accessibilityRole="button"
              accessibilityLabel="Retry"
              hitSlop={8}
            >
              <Text style={styles.retry}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        <ChatComposer
          busy={busy}
          onSend={(text) => void sendMessage({ text })}
          onStop={() => void stop()}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

function friendlyError(err: Error): string {
  const msg = err.message || "";
  if (msg.includes("rate limited")) return "You’re sending messages too fast — give it a minute.";
  if (msg.includes("unauthorized")) return "Your session expired. Sign in again from Account.";
  if (/network|fetch|failed/i.test(msg) && !/\(\d{3}\)/.test(msg))
    return "You appear to be offline. Chat needs a connection.";
  return msg || "Something went wrong.";
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, padding: 16 },
    messages: { gap: 10, paddingBottom: 16 },
    headerBtns: { flexDirection: "row", gap: 16, paddingRight: 4 },
    headerAction: { color: t.color.ink, fontSize: 16, fontWeight: "600" },
    errorRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      marginTop: 8,
    },
    error: { color: t.color.danger, flex: 1, fontSize: 13 },
    retry: { color: t.color.ink, fontSize: 13, fontWeight: "700" },
  });
}
```

Also add the spec's "jump to latest" pill to `ChatView` (shown when the user has scrolled away from the bottom; `maintainScrollAtEnd` stops pinning in that state):

```tsx
import type { LegendListRef } from "@legendapp/list";
// inside ChatView:
const listRef = useRef<LegendListRef | null>(null);
const [awayFromEnd, setAwayFromEnd] = useState(false);
// on the LegendList element:
//   ref={listRef}
//   onScroll={(e) => {
//     const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
//     const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
//     setAwayFromEnd(distance > 80);
//   }}
//   scrollEventThrottle={64}
// floating pill, rendered as a sibling overlaying the list (only while streaming or with messages):
{awayFromEnd ? (
  <Pressable
    style={styles.jumpPill}
    onPress={() => listRef.current?.scrollToEnd({ animated: true })}
    accessibilityRole="button"
    accessibilityLabel="Jump to latest"
  >
    <Text style={styles.jumpPillText}>↓ Latest</Text>
  </Pressable>
) : null}
// styles:
//   jumpPill: { position: "absolute", bottom: 76, alignSelf: "center",
//     backgroundColor: t.color.ink, borderRadius: 999,
//     paddingHorizontal: 14, paddingVertical: 8 },
//   jumpPillText: { color: t.color.paper, fontSize: 13, fontWeight: "600" },
```

(Wrap the list + pill in a `<View style={styles.flex}>` so the pill's absolute position is relative to the list area. If `LegendListRef` lacks `scrollToEnd` in the installed d.ts, use its documented scroll method instead — installed types win.)

Notes for the implementer:
- If `useChat`'s option for initial messages in the installed `@ai-sdk/react@3` is named differently (`messages` vs `initialMessages`), match the installed d.ts.
- If `maintainScrollAtEnd`/`maintainVisibleContentPosition` prop types want objects instead of booleans in `@legendapp/list@3.3`, match its d.ts (e.g. `maintainScrollAtEnd={{ on: { dataChange: true } }}`).
- `ChatsModal` still imports `chatConversations` via its own file — the screen no longer touches drizzle live queries.

- [ ] **Step 8: Typecheck mobile (force)**

Run: `bunx turbo check-types --filter=mobile --force`
Expected: FAIL only in `lib/llm/test-bench.ts` (still importing the deleted-in-Task-6 `chat-stream`) — everything new must be clean. If other errors appear, fix them now.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/components/chat apps/mobile/src/app/llm.tsx
git commit -m "feat(mobile): rebuild /llm on useChat — markdown, tool activity, stop/retry, LegendList" -- apps/mobile/src/components/chat apps/mobile/src/app/llm.tsx
```

---

### Task 6: Bench update, dead-code removal, living-doc anchors, full verification

**Files:**
- Modify: `apps/mobile/src/lib/llm/test-bench.ts` (`runServerChatTest` onto `streamChatTurn`)
- Delete: `apps/mobile/src/lib/research/chat-stream.ts`, `apps/mobile/src/lib/research/sse-parse.ts`, `apps/mobile/src/lib/research/chat-stream.test.ts`
- Modify: `docs/llm/LLM-SOURCE-OF-TRUTH.md` (§0 chat row, §3.2/§3.5/§3.7, anchors A12/A14/A15, drift + decision logs)

**Interfaces:**
- Consumes: Task 4's `streamChatTurn`; Task 3's `ChatUIMessage`/`SourcePost`/`textOf`.

- [ ] **Step 1: Rewrite `runServerChatTest`**

Replace the `apiChatStream` import block with:

```ts
import { textOf } from "@/lib/chat/message-map";
import { streamChatTurn } from "@/lib/chat/transport";
import type { SourcePost } from "@/lib/chat/types";
```

and the body of `runServerChatTest` (keep the fixture + FixtureResult contract):

```ts
export async function runServerChatTest(): Promise<FixtureResult> {
  const start = Date.now();
  const checks: DraftCheck[] = [];
  let answer = "";
  let sources: SourcePost[] = [];
  let transportError: string | null = null;
  try {
    const final = await streamChatTurn({
      messages: [
        {
          id: "bench-user",
          role: "user",
          parts: [{ type: "text", text: SERVER_CHAT_FIXTURE.question }],
        },
      ],
    });
    answer = textOf(final);
    const sourcesPart = final.parts.find(
      (p) => p.type === "data-source-posts",
    );
    if (sourcesPart && "data" in sourcesPart) sources = sourcesPart.data;
  } catch (e) {
    transportError = e instanceof Error ? e.message : String(e);
  }
  // …the existing checks (no-transport-error / answer-streamed / answer-preview /
  // sources informational) stay verbatim, minus any ChatStreamError reference.
```

Also delete the now-unused `apiChatStream`/`ChatStreamError`/`ChatSourceDTO` import.

- [ ] **Step 2: Delete the old transport**

Run: `grep -rn "chat-stream\|sse-parse" apps/mobile/src/` — expected: no hits outside the three files being deleted. Then:

```bash
git rm apps/mobile/src/lib/research/chat-stream.ts apps/mobile/src/lib/research/sse-parse.ts apps/mobile/src/lib/research/chat-stream.test.ts
```

- [ ] **Step 3: Update `docs/llm/LLM-SOURCE-OF-TRUTH.md`** (same commit as the code!)

- §0 table, server-chat row: note the route now speaks the **AI SDK UI message stream** and mobile consumes with `useChat`.
- §3.2 data flow: replace the SSE line with `createUIMessageStream → UIMessageChunks (text/tool/data-source-posts)` and `useChat + DefaultChatTransport (expo/fetch)` on the mobile side.
- §3.5: note the screen is now `useChat`-based, components under `components/chat/`, history persists UIMessage parts (`parts_json`).
- §3.7: add `@ai-sdk/react ^3.0.220` + `@legendapp/list ^3.3.0` to the mobile dep note.
- Anchors:
  - A12 → check `rg "useChat" apps/mobile/src/app/llm.tsx` PRESENT and `rg "askMyPosts|apiChatStream"` ABSENT.
  - A14 → `rg -n "createChatTransport" apps/mobile/src/lib/chat/transport.ts` PRESENT.
  - A15 → `rg -n "createUIMessageStream" apps/web/app/api/app/chat/route.ts` PRESENT (protocol = AI SDK UI message stream; `sse-parse.ts` deleted).
- Drift log + decision log: dated entry (2026-07-02) — protocol migrated to the AI SDK UI message stream (supersedes the 2026-07-01 hand-rolled-SSE deviation note), history now UIMessage-shaped, spec/plan paths.
- Bump "Last validated".

- [ ] **Step 4: Full verification (force, no cache)**

```bash
bun test apps/web/lib/chat apps/mobile/src/lib/chat
bunx turbo check-types --filter=web --filter=mobile --force
bunx turbo lint --filter=web --filter=mobile --force
```
Expected: all PASS, zero warnings (`--max-warnings 0`).

- [ ] **Step 5: Live route smoke (best-effort)**

If a dev web server is reachable (https://sirius.local or :3000), sign in with the dev account and curl:

```bash
COOKIE=$(curl -sk -c - -X POST https://sirius.local/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d "{\"email\":\"saleebmina@icloud.com\",\"password\":\"$DEV_LOGIN_PASSWORD\"}" \
  | awk '/better-auth/ {print $6"="$7}' | paste -sd'; ' -)
curl -skN -X POST https://sirius.local/api/app/chat \
  -H "cookie: $COOKIE" -H 'content-type: application/json' \
  -d '{"id":"smoke","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"What have I saved about the marina?"}]}]}' | head -40
```
Expected: SSE lines with `data: {"type":"start"...}`, `text-delta` chunks, possibly `data-source-posts`, ending in `finish`/`[DONE]`. If no server is running, skip — the sim pass covers it (user-driven).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/llm/test-bench.ts docs/llm/LLM-SOURCE-OF-TRUTH.md
git commit -m "feat(mobile): bench on UI message stream; retire hand-rolled chat SSE; update LLM source-of-truth anchors" -- apps/mobile/src/lib/llm/test-bench.ts docs/llm/LLM-SOURCE-OF-TRUTH.md apps/mobile/src/lib/research/chat-stream.ts apps/mobile/src/lib/research/sse-parse.ts apps/mobile/src/lib/research/chat-stream.test.ts
```

- [ ] **Step 7: Hand the user the manual sim test script**

Provide exact steps: `! bun run dev` (interactive, portless :443 needs sudo), open `/llm` from Catalog's "Ask your library", send a question → watch activity line → markdown answer + Sources; Stop mid-stream; switch threads via Chats; kill/reopen app → thread restored; `siriusapp://llm-test?run=serverchat` for the bench card. Ask for specific feedback: autoscroll feel, markdown rendering, activity line timing, Stop behavior, restored history fidelity.
