# On-device agentic "Ask my posts" — ground-up redesign

**Date:** 2026-06-20
**Status:** Approved (design); implementation gated on a tool-calling spike (Phase 0)
**Surface:** `apps/mobile` (`/llm` chat), `@repo/research-agent`, mobile SQLite schema

## Problem

The on-device "Ask my posts" chat has three structural defects:

1. **It feels slow and like it reloads the model on every question.** The model is
   actually resident the whole time (`engine.ts` keeps one llama context loaded as a
   singleton; nothing unloads it between turns). The real cause is that
   `apps/mobile/src/lib/research/ask.ts` bakes the top-6 retrieved post **bodies into
   the system message on every turn**. A changing system prefix means llama.cpp cannot
   reuse its KV cache, so it re-prefills the entire conversation each question. On a 3B
   model that multi-second prefill is the "long pause" and is indistinguishable from a
   reload.
2. **No agency over sources.** A `decideResearch` router exists in
   `@repo/research-agent` but `ask.ts` never calls it. Every ask-mode question runs the
   search and dumps all top-6 results into context, whether or not they're relevant.
3. **No depth on a single post.** Retrieved bodies are capped at 1000 chars
   (`tools.ts` `BODY_CAP`), so asking about one specific post yields a blurb, never the
   full text.

## Goals

- The on-device model **decides** whether to consult the library; **sources only appear
  when the model chooses them**, and only the posts that matter enter context — not the
  full candidate set.
- Asking about a single post (naturally, in chat — e.g. "tell me more about my Kyoto
  post") loads that post's **full body + metadata** and answers in depth.
- The chat is **fast and stays warm**: the resident model is reused, the conversation's
  KV cache is reused across turns, and the first reply after opening isn't cold.
- **"New conversation" clears memory**: a fresh thread AND a reset of the model's
  conversation KV cache (without unloading the model).
- Built on **AI SDK conversation threads** (a growing `ModelMessage[]` that includes
  tool-call / tool-result parts), persisted so a reopened thread restores exact context.

## Non-goals

- On-device query embedding. The text encoder is dormant/crashy (see `engine.ts`); the
  query stays embedded **server-side** (`/api/app/research/embed-query`). `search_posts`
  therefore needs network — but only when the agent actually searches.
- Changing the worker's embedding pipeline or the `post_vectors` sync.
- "Chat" (free, ungrounded) mode behavior — unchanged except it shares the warm context
  and KV-reset-on-new-conversation.

## Architecture: a stable-prefix agentic tool loop

The core change is moving retrieved content **out of the per-turn system prompt and into
the message thread as tool results**, so the prompt prefix is stable and only grows.

### Stable system prompt
Set once per conversation. Contains the agent's instructions + tool descriptions. Never
mutated turn to turn. This is the precondition for KV-cache reuse.

### Tools (model-driven)
- `search_posts({ query })` → returns **lightweight candidates only**:
  `[{ id, title, excerpt, score }]`. No bodies. Implemented by the host: embed the query
  server-side, cosine-rank the local `post_vectors` index (existing `searchPosts` /
  `sqliteVectorStore`). This is "don't load all the results."
- `get_post({ id })` → returns the **full body + tags, categories, date** of one post,
  read from the local `posts` table. This is the single-post deep-dive primitive AND what
  the model calls to pull a referenced post into context.

### The per-turn loop
1. Append the user message to the thread.
2. Run an agentic `streamText` with `tools: { search_posts, get_post }` and a bounded
   `stopWhen` (step cap), against the resident chat model under the existing inference
   mutex (`withPreparedModel(modelId, "chat", …)`).
3. The model decides:
   - Small talk / general knowledge → answers directly. No search, no Sources.
   - Library question → `search_posts(query)` → reads candidates → `get_post(id)` for the
     subset that matters → answers, citing them.
   - "tell me about my X post" → `search_posts` to locate it → `get_post` for the full
     body → in-depth answer.
4. **Sources = exactly the posts the model opened** via `get_post` (captured during the
   loop), rendered as the existing tappable Source cards. Context only ever holds the
   candidate summaries (cheap) plus the full text of opened posts.

### Speed / warmth
- **KV reuse:** guaranteed by the stable prefix + append-only thread. The discipline:
  never rewrite earlier messages or the system prompt mid-conversation (the old code's
  sin).
- **Pre-warm:** on chat-screen mount, when the model is ready, kick `getPreparedModel`
  (and optionally a 1-token warm completion) so the first send isn't cold.
- **"Seems to reload" verification:** confirm `@react-native-ai/llama@0.12` reuses the
  same llama context across successive `streamText` calls. If it tears the context down
  per call, that is the true "reload" and the fix is to hold a persistent llama.rn
  context we own. (Verified in Phase 0.)
- **New conversation:** a fresh (empty) message thread. A conversation's "memory" *is*
  the messages array we pass the model, so an empty thread already clears it — no native
  KV reset is needed (the KV cache is a transparent prefix cache, not retained content).
  This was simplified from an earlier `resetContext` idea during planning.

## Components & changes

### `@repo/research-agent`
- Add a `get_post` tool definition + schema (input `{ id }`, output full post).
- Add a `GetPostPort` to `ports.ts` so the host injects the full-post fetch.
- Add an **agentic runner** (`runAgenticAsk`) that wires `search_posts` + `get_post` with
  `execute`, loops via `stopWhen`, streams the answer, and returns the set of opened-post
  ids for the Sources UI. Keep `searchPosts` / `streamResearchAnswer` / `decideResearch`
  for the fallback runner.
- New, **stable** agent system prompt (instructions + when to use each tool + citation
  rules), distinct from the per-turn `buildAnswerSystem` (which the fallback may still
  use).

### `apps/mobile/src/lib/research/`
- `tools.ts`: add `fullPostById(id)` (full body + tags/categories/date) for the
  `get_post` port; keep candidate trimming for `search_posts`.
- `ask.ts`: replace the always-search-then-dump flow with the agentic runner; map its
  phases to the existing `onPhase` UI states; collect opened-post ids → `ScoredPost[]`
  Sources.

### `engine.ts`
- `prewarm(modelId)` — ensure the context is prepared (and warm) ahead of first use.
- Confirm context reuse across `streamText` calls (Phase 0); if the adapter tears the
  context down per call, own the llama.rn context directly.

### Persistence (no schema change)
- **Decided in planning:** no `parts_json` migration. Re-feeding old tool-call/tool-result
  parts every turn would bloat context for no benefit; persisting user/assistant **text**
  turns + `sources_json` (both columns already exist) is sufficient. Each continued turn
  re-runs the tools fresh, and old turns' Sources restore from `sources_json`. `chat.ts`
  and the schema are unchanged.

### `llm.tsx`
- Drive the agentic loop; "New" → new thread + `resetContext()`; pre-warm on mount.
  Sources rendering unchanged.

## Phase 0 — spike (before committing to full-agentic)

Verify on the iOS sim (via the existing `/llm-test` bench / `?run=ask`) that **Qwen-3B
tool calls surface through `@react-native-ai/llama@0.12` + llama.rn 0.12.4**. Qwen emits
`<tool_call>` blocks via its chat template; this is a different path from `Output.object`
(which returns empty on-device — see the `llama-rn-structured-output` note), so it is not
assumed to work.

- **If tool-calling works:** ship the full model-initiated runner (`runAgenticAsk`).
- **If unreliable:** fall back to a deterministic runner — always run `search_posts`, then
  have the model **select** which candidate ids matter and `get_post` those. Still "agent
  chooses sources," still lean context, still the KV-reuse speed win, same tools, same UI.
  Only the runner differs; all other components are shared, so Phase 0's outcome only
  picks the runner.

## Build order

0. Spike: tool-calling reliability + context-reuse verification on the sim.
1. `@repo/research-agent`: `get_post` tool/schema/port + agentic runner + stable prompt.
2. mobile `tools.ts` full-post fetch; `engine.ts` `resetContext` + `prewarm`.
3. `ask.ts` rewired to the chosen runner.
4. `llm.tsx` pre-warm on mount (new-conversation already clears the thread).
5. Verify end to end on the sim: speed (no per-turn long pause), selective sources,
   single-post depth, new-conversation memory clear.

## Risks

- **Tool-calling on-device** — mitigated by Phase 0 + the deterministic fallback.
- **KV reuse not actually kicking in** (adapter resets context per call) — Phase 0
  confirms; fallback is owning the llama.rn context directly.
- **`search_posts` needs network** (server embed) — accepted non-goal; the agent skips it
  for non-library questions, so it's no longer on the critical path of every turn.
