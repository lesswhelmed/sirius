# LLM Source of Truth — Sirius critical AI features

> **This is a LIVING DOCUMENT.** It is the single source of truth for every LLM /
> AI feature in the app: what exists today, what's parked, and the design we're
> migrating toward. A background `/loop` (every 4 min) validates the **Anchors**
> in §5 against the real code and flags drift. When code changes, this doc must be
> updated in the same change. If the loop reports an anchor miss, fix the doc (or
> the code) — do not let them diverge.

- **Owner:** Sirius team
- **Created:** 2026-07-01
- **Last validated:** 2026-07-01 (post-migration, RECONCILED) — server-chat v1 SHIPPED (Tasks 1–6, commits 4c9b797, d19024e, 7e07732, 9a457bf, e5dc196 + this doc). All 15 anchors now reflect the live state (A1–A7, A11 on-device/parked+infra; A8–A10, A12–A15 the shipped server chat). Steady state: future ticks should find everything matching — just bump this line. USER-PENDING: live curl `/api/app/chat` + `/llm` sim check.
- **Related docs:** `docs/HANDOFF-on-device-ai.md`, `docs/search-ranking.md`,
  `docs/friends-feed.md`, `packages/research-agent/`, `apps/mcp/`

---

## 0. TL;DR / current status

| Capability | Where | Runtime | Status |
|---|---|---|---|
| **Drafting** (note→BLOG, url→FINDING, image→SIGHT) | `apps/mobile/src/lib/llm/curate.ts` | on-device llama.rn (+ server `/extract` for URL) | ⚠️ **PARKED** — implemented, bench-tested, NOT wired to any live submit path (`onDeviceCuration` forced `false`). Production drafting = server worker. |
| **Ask my posts** (on-device chat) | `apps/mobile/src/lib/research/ask.ts` (`askMyPosts`) | on-device select+answer, server query-embed | 🔌 **UNHOOKED** — `/llm` no longer calls it (commit `e5dc196`). Code + embed-query + sqlite vector store **retained but not reachable**, reusable later. |
| **Transcription** | `apps/mobile/src/lib/llm/transcribe.ios.ts` | on-device Apple SpeechAnalyzer (iOS 26+) | ✅ live; feeds drafting. Untouched by the migration. |
| **Server draft pipeline** | `apps/worker/src/pipeline/gemini-runner.ts` | server Gemini (Vercel AI SDK) | ✅ live; the real production drafter. |
| **Curated search** (catalog bar) | `packages/db/src/search.ts` `searchCorpus` | server Postgres FTS + embedding RRF | ✅ live; the retrieval core the new chat will reuse. |
| **MCP corpus server** | `apps/mcp/` | server, per-user apiKey | ✅ live; external-agent tool surface. |
| **Server chat agent** (Gemini Flash, tool loop) | `apps/web/app/api/app/chat/route.ts` + `apps/web/lib/chat/agent.ts` | server Gemini Flash 3.5 | ✅ **LIVE (v1 shipped)** — the `/llm` chat backend. See §3. Live curl + sim verification are USER-PENDING. |

---

## 1. The on-device engine (mobile)

`apps/mobile/src/lib/llm/engine.ts` — singleton llama.rn holder, **one resident GGUF
model at a time**, guarded by an inference mutex.

- `checkNativeBridge()` — probes the JSI bridge is compiled into this binary (stale-binary guard).
- `isModelReady(id)` — weights + projector + `.complete` marker on disk.
- `downloadModelById(id, onProgress)` — downloads weights (+ mmproj) from HuggingFace.
- `getPreparedModel(id)` / `withPreparedModel(id, holder, fn)` — load-one-resident + mutex.
  `holder ∈ "chat" | "draft" | "embed-query" | "embed-index"`.
- `prewarm(id)` / `releaseModel()` / `modelBusyBy()`.
- **DEAD CODE:** the `embedding` branch + `withEmbeddingModel` / `embed-index` holder
  (on-device nomic encoder crashed; never used). `engine.ts` ~line 188 documents this.

**Models** — `apps/mobile/src/lib/llm/models.ts` (`LOCAL_MODELS`):

| id | role | size |
|---|---|---|
| `qwen2.5-3b-instruct` (DEFAULT) | chat + note/URL drafting | 2.1 GB |
| `qwen2.5-1.5b-instruct` | smaller chat/draft | 1.12 GB |
| `smolvlm2-2.2b-instruct` (`VISION_MODEL_ID`) | SIGHT drafting (+ mmproj projector) | 1.6 GB |
| `nomic-embed-text-v1.5` (`EMBEDDING_MODEL_ID`) | **DORMANT** (crashed encoder) | 84 MB |

---

## 2. On-device capabilities (detail)

### 2.1 Drafting — `apps/mobile/src/lib/llm/curate.ts` — ⚠️ PARKED
Recipe: **plain `generateText` (from `ai`) + `extractJsonObject` + `schema.parse`** —
deliberately NOT `Output.object` (json-grammar returns empty completions on
llama.rn 0.12.4).
- `generateDraft(schema, pending)` — core recipe.
- `draftNotePost(notes)` → BLOG (on-device).
- `draftUrlPost(summary, notes)` → FINDING (page summary from server `/api/app/extract`, draft on-device).
- `draftSightPost(imageUris, notes)` → SIGHT (vision model, on-device).
- Gates: `canDraftOnDevice()` / `canDraftSightOnDevice()` = `ON_DEVICE_AI_ENABLED &&
  settings.onDeviceCuration && checkNativeBridge().ok && isModelReady(id)`.
- **Why parked:** composer (`app/(tabs)/composer.tsx`) hard-codes `onDeviceCuration:false`;
  nothing writes it `true`. Handlers live in `apps/mobile/src/lib/materials.ts`
  (`noteHandler`/`urlHandler`/`imageHandler`/`audioHandler`) but no live submit path invokes them.
  **Keep intact — reusable later.**

### 2.2 Ask my posts (on-device chat) — `apps/mobile/src/lib/research/ask.ts` — ⚠️ UNHOOKED (parked)
> **As of e5dc196, `/llm` no longer calls `askMyPosts`** — it streams from the server chat
> agent (§3). The on-device 3-step below is retained & compiling (reusable) but not reached
> from any screen. The rest of this section documents the parked implementation.
`askMyPosts(args)` — 3 steps, single resident chat model, **no model-initiated tool calls**:
1. **search** — embed query **SERVER-SIDE** (`research/embed-query.ts` → `POST /api/app/research/embed-query`;
   device has no text encoder) then cosine-rank the **local `post_vectors` sqlite index**
   (`research/vector-store.ts` `sqliteVectorStore`, via `@repo/research-agent` `searchPosts`).
   `TOP_K=6`, `MIN_SCORE=0.25`. Offline → clear error, no fallback.
2. **select** — on-device model picks candidate numbers (`generateText`, `maxOutputTokens:24`).
3. **answer** — on-device `streamResearchAnswer` streams grounded answer over chosen full bodies.
- Post vectors are produced **server-side by the worker's Gemini** and synced down
  (`apps/mobile/src/lib/sync/reconcile.ts` `mirrorPostVector`) — never embedded on-device.
- Entry: `apps/mobile/src/app/llm.tsx` (`Chat` component; restores history from local
  sqlite `lib/db/chat`, renders Sources).
- **Weakness driving the migration:** already pays a network round-trip, then does the
  hard parts (relevance + synthesis) on a tiny 3B model; retrieval is semantic-only
  (worse than the catalog `searchCorpus`).

### 2.3 Transcription — `apps/mobile/src/lib/llm/transcribe.ios.ts` — ✅ LIVE
Apple SpeechAnalyzer (`@react-native-ai/apple`, iOS 26+). `prepareTranscription()`,
`canTranscribeOnDevice()`, `transcribeAudio(uri)`. Feeds `draftNotePost`. Not gated by
`ON_DEVICE_AI_ENABLED`. **Untouched by the migration.**

### 2.4 Feature flag — `apps/mobile/src/lib/llm/flag.ts`
`ON_DEVICE_AI_ENABLED = process.env.EXPO_PUBLIC_ON_DEVICE_AI === "true"` (build-time,
Expo-inlined). Master switch for on-device **drafting**. After the migration, **chat no
longer depends on it** (chat becomes always-online).

### 2.5 Dev bench — `apps/mobile/src/app/llm-test.tsx` + `apps/mobile/src/lib/llm/test-bench.ts`
`__DEV__ && ON_DEVICE_AI_ENABLED`. Deep-link `siriusapp://llm-test?run=ask|answer|gen-diag|toolprobe|all`.
Runners: `runAskFlowTest`, `runAnswerQualityTest`, `runGenDiagnostic`, `runToolProbe`,
draft-fixture runners, iOS `AudioBench`.

---

## 3. SHIPPED (v1): server-side chat agent

**Status:** LANDED on `main` (Tasks 1–5, commits below). Replaced the weak on-device chat
with a server Gemini Flash 3.5 agent that drives retrieval via tools — reusing the catalog
search core + the existing agent scaffolding. Web chat + generative UI + richer insights
remain **later specs**. Remaining = USER-DRIVEN verification: curl the route (`§3.2`) and
the `/llm` sim check. Commits: 4c9b797 (T1 friend-scope) · d19024e (T2 agent+deps) ·
7e07732 (T3 SSE route) · 9a457bf (T4 mobile client) · e5dc196 (T5 `/llm` rewire).

### 3.1 Approach (chosen: A — in-process agent on a web route)
New session-authed route **`POST /api/app/chat`** in `apps/web`. Builds a Gemini Flash
model, runs `runAskAgent` (from `@repo/research-agent`, extended for friend-scope), backs
its two tools with **in-process `@repo/db` calls**, streams back. Mobile `/llm` points
`send()` at this route.

Rejected: **B** (agent → MCP over HTTP) = right shape for *external* agents / richer
browse tools, deferred to v2. **C** (bespoke streamText loop) = drifts from shared code.

### 3.2 Data flow
```
MOBILE /llm.tsx  send(messages) → apiChatStream() [expo/fetch streaming]
   ▼
POST /api/app/chat   (session-authed getSessionOrNull, rate-limited)  viewerId = session.user.id
   ▼
runAskAgent({ llm, search, getPost, messages })          ← @repo/research-agent (reused, extended)
   llm = createGoogleGenerativeAI({apiKey})("gemini-3.5-flash")   ← @ai-sdk/google (added to apps/web, d19024e)
   ├ tool search_posts({ query, includeFriends })         ◄ Gemini sets args
   │    └► searchCorpus(viewerId, query, { scope: includeFriends ? "all" : "mine" })  ← @repo/db
   │         SearchHit[] → Candidate[] {id,title,excerpt,score}
   └ tool get_post({ id })                                 ◄ Gemini opens what matters
        └► visibility-gated post read (@repo/db)  → FullPost (→ run.opened = Sources)
   ▼
hand-rolled SSE ReadableStream → data:{t:"token",v} … data:{t:"sources",v:[…]} … data:{t:"done"}
   ▼ mobile: expo/fetch stream → parseSseChunk (sse-parse.ts) → onDelta / onSources → Sources card
```

### 3.3 Retrieval scope (friends nuance)
Default `scope:"mine"`. Gemini sets `includeFriends:true` **only when the question is
about friends**, mapping to `searchCorpus` `scope:"all"` — which, because
`PUBLIC_CATALOG_ENABLED` is off, resolves to **viewer's posts + friends' shared posts**
(no stranger content). `searchVisibilityWhere` enforces this in SQL; `get_post` is
independently visibility-gated. Model cannot over-reach even with a wrong flag.

### 3.4 Shared-agent extension (decided)
Extend `@repo/research-agent`: add optional `includeFriends` (or `scope`) to
`PostSearchInputSchema` + thread through `AskAgentDeps.search`. Backward-compatible
default (`mine`) so the parked mobile path is unaffected. Update `AGENT_SYSTEM_PROMPT`
to explain when to include friends.

### 3.5 Mobile `/llm` becomes a pure online AI chat
- **Remove:** model download card, `ModelPicker`, transcription-assets prep, `checkNativeBridge`/
  `isModelReady` gating, `prewarm`, "waiting for the drafter…" busy state.
- **Keep:** conversation history (local sqlite `lib/db/chat`), Sources card, streaming render, composer.
- **Swap:** `send()` → new `apiChatStream()` (POST → consume `expo/fetch` stream).
- **Leave parked & intact:** `engine.ts`, `curate.ts`, transcription, `models.ts`,
  vector store + `mirrorPostVector`.
- **Offline:** no offline chat — clean "you're offline" state.

### 3.6 Cost guard (decided)
Reuse `/api/app/extract`'s in-memory sliding-window limiter (per-user + global) — correct
for the single pm2 web process. Upgrade to DB-backed only when multi-instance.

### 3.7 Model / client
`gemini-3.5-flash` (matches worker `DEFAULT_MODEL` in `apps/worker/src/lib/ai-config.ts`).
`@ai-sdk/google ^3.0.73` + `ai ^6.0.182` — **added to `apps/web/package.json`** (d19024e;
`bun.lock` needed only 3 new dep-list lines since both were already resolved elsewhere in
the monorepo). Key via `requireApiKey()` from `@repo/db`.

### 3.8 Sources
`run.opened` already collects exactly the posts `get_post` touched (dedup'd). Emit as a
trailing data part; existing Sources card renders unchanged (tap-through `/post/[slug]`).

---

## 4. Reusable server pieces (already in the repo)

- `@repo/research-agent` — `runAskAgent({ llm, search, getPost })` streaming tool loop
  (`ask-agent.ts`), `AGENT_SYSTEM_PROMPT`, `PostSearchInputSchema`/`GetPostInputSchema`,
  `searchPosts`, `streamResearchAnswer`. Model-agnostic (injected `LanguageModel`).
- `@repo/db` — `searchCorpus(viewerId, query, {scope,limit,cursor,embedder})` → `SearchPage`
  (`{items: SearchHit[], nextCursor, partial}`), `searchVisibilityWhere`, `embedContent`,
  `queryPrefix`, `requireApiKey`. (`packages/db/src/search.ts`, `embed-client.ts`.)
- `apps/mcp` tools (v2 tool surface): `full_text_search` (already on `searchCorpus`),
  `semantic_search` (per-hit score), `get_post`, `browse_category`, `list_projects`,
  `classify_text`. Auth = better-auth `apiKey()`.
- `apps/worker/src/pipeline/gemini-runner.ts` — Gemini via `@ai-sdk/google`,
  `generateText` + `Output.object`, `url_context` tool (via `@repo/extraction`).

---

## 5. Anchors (what the /loop validates)

Each anchor is a claim + a cheap check. If a check fails, the code moved — reconcile
this doc (or the code) immediately. `[LIVE]` must exist now; `[PLANNED]` should NOT
exist until the migration lands (its appearance = progress, update status).

| # | Anchor | Check | Expect |
|---|---|---|---|
| A1 | On-device engine singleton | `rg -n "checkNativeBridge" apps/mobile/src/lib/llm/engine.ts` | `[LIVE]` present |
| A2 | Drafting recipe (no Output.object) | `rg -n "extractJsonObject|generateDraft" apps/mobile/src/lib/llm/curate.ts` | `[LIVE]` present |
| A3 | Drafting still PARKED | `rg -n "onDeviceCuration: false" apps/mobile/src/app/\(tabs\)/composer.tsx` | `[LIVE]` present (if gone, drafting may be un-parked — update §2.1) |
| A4 | On-device chat 3-step (PARKED) | `rg -n "askMyPosts" apps/mobile/src/lib/research/ask.ts` | `[LIVE]` present — `ask.ts` retained & parked, no longer reached from `/llm` |
| A5 | Server query-embed dependency | test `apps/web/app/api/app/research/embed-query/route.ts` exists | `[LIVE]` |
| A6 | Search core | `rg -n "export async function searchCorpus" packages/db/src/search.ts` | `[LIVE]` present |
| A7 | Reusable agent | `rg -n "export function runAskAgent" packages/research-agent/src/ask-agent.ts` | `[LIVE]` present |
| A8 | Friend-scope extension | `rg -n "includeFriends" packages/research-agent/src/schema.ts` | `[LIVE]` present (4c9b797) |
| A9 | Server chat route | test `apps/web/app/api/app/chat/route.ts` exists | `[LIVE]` exists (7e07732) |
| A10 | Web AI deps added | `rg -n "@ai-sdk/google" apps/web/package.json` | `[LIVE]` present (d19024e) |
| A11 | Worker Gemini model | `rg -n "gemini-3.5-flash" apps/worker/src/lib/ai-config.ts` | `[LIVE]` present |
| A12 | Mobile `/llm` is ONLINE chat | `apps/mobile/src/app/llm.tsx`: `rg "apiChatStream"` PRESENT **and** `rg "askMyPosts\|prewarm"` ABSENT | `[LIVE]` migrated (e5dc196) |
| A13 | Server chat module | `rg -n "runChatTurn" apps/web/lib/chat/agent.ts` | `[LIVE]` present (d19024e) |
| A14 | Mobile chat stream client | `rg -n "apiChatStream" apps/mobile/src/lib/research/chat-stream.ts` | `[LIVE]` present (9a457bf) |
| A15 | SSE frame protocol shared | `rg -n "parseSseChunk" apps/mobile/src/lib/research/sse-parse.ts` | `[LIVE]` present (9a457bf) |

**Validation loop procedure (every 4 min):** run the checks above; for each mismatch,
note it under §6 with a timestamp and reconcile the doc. Update **Last validated** at the
top. Keep it cheap — grep-level checks, not a full re-exploration.

---

## 6. Drift log (loop-maintained)

- **2026-07-01 — server-chat migration LANDED (Tasks 1–5), EXPECTED not drift.** Anchors
  A8/A9/A10 flipped absent→present; A12 flipped from on-device (`askMyPosts`/`prewarm`) to
  online (`apiChatStream`); A4 re-scoped to "parked" (ask.ts retained, unreached); A13–A15
  added. §0 status table + §3 reconciled to SHIPPED. Commits 4c9b797, d19024e, 7e07732,
  9a457bf, e5dc196. Executed subagent-driven (coordinator SunnyGorge); each task reviewed
  clean. Remaining = USER-DRIVEN: curl `/api/app/chat` + `/llm` sim check.

---

## 7. Decision log

- **2026-07-01** v1 scope = mobile chat, server-backed (web chat + generative UI later).
- **2026-07-01** Tool model = agentic loop (Gemini drives search + get_post; relevance is native).
- **2026-07-01** Retrieval scope = mine by default; friends only when the model flags
  `includeFriends` (an LLM call), via `searchCorpus` `scope:"all"` with public gated off.
- **2026-07-01** On-device chat: unhook from `/llm`, keep engine + drafting parked and intact.
- **2026-07-01** Friend-scope = extend the shared `@repo/research-agent` (backward-compatible).
- **2026-07-01** Cost guard = reuse `/extract`'s in-memory limiter for v1.
- **2026-07-01 SHIPPED** — implementation deviations from the plan (all reviewed/accepted):
  (1) SSE is **hand-rolled** (`ReadableStream` emitting `data:{t:"token"|"sources"|"done"|"error"}\n\n`,
  repo convention), not `toUIMessageStreamResponse` — mobile consumes via `expo/fetch` + a
  pure `parseSseChunk` split into `apps/mobile/src/lib/research/sse-parse.ts` (nav.ts/nav-dedupe.ts
  precedent, so `bun test` doesn't load `react-native`).
  (2) Mobile cookie = `authClient.getCookie()` (same getter `uploadFile()`/`sync/sse.ts` use),
  NOT `@better-auth/expo/client`'s `getCookie` (wrong signature).
  (3) `bun:test` files excluded from tsc in `research-agent`/web tsconfig (db/embedding-scene precedent).
  (4) Persisted chat sources keep `ScoredPost` with an inert `score:0` (avoids touching db/chat schema).
- **Open (final-review triage):** route abort-robustness (guard `send`/`close` on torn-down
  controller); redundant `frames as ChatFrame[]` cast (chat-stream.ts); `hit.snippet ?? hit.excerpt`
  dead fallback (agent.ts); tool-level `description`/`AGENT_SYSTEM_PROMPT` preamble don't yet mention
  friend-scope (affects how reliably the model picks it).
