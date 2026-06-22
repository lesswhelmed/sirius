# MCP Server — Corpus-as-LLM-Wiki for External Agents

**Date:** 2026-06-21
**Status:** Approved design, pending implementation plan
**Scope:** A new `apps/mcp` standalone service that exposes each user's post corpus to external AI agents over the Model Context Protocol (MCP), so agents can search, semantically retrieve, navigate the taxonomy, and reference posts as wiki-like context.

---

## 1. Goal & use case

External AI agents (Claude, other MCP hosts) should be able to use a Sirius user's own
corpus as a reference knowledge base — an "LLM wiki." A connected agent can:

- **Discover** material by keyword, full-text, or semantic similarity.
- **Navigate** the user's taxonomy (`CategoryEmbedding` topic tree) and projects.
- **Retrieve** full post content to cite or summarize.
- **Categorize** arbitrary text against the user's taxonomy ("where would this file?").
- **Attach** posts/categories as MCP **Resources** (wiki pages) and use guided **Prompts**.

The wiki is **per-user (multi-tenant)**: an agent authenticates with a user-issued API key
and sees exactly that user's owner-scoped corpus — including their `PRIVATE` posts, because
the key *is* that user's delegated access. No cross-user data is ever reachable.

---

## 2. Decisions (locked via brainstorming)

| Decision | Choice |
| --- | --- |
| Content scope | **Per-user multi-tenant.** Key → `userId`; owner-scoped corpus incl. PRIVATE. |
| Transport / hosting | **Standalone Bun HTTP service** `apps/mcp` (not mounted in Next). Streamable HTTP. |
| Auth | **better-auth `apiKey()` plugin** added to `@repo/auth`. Expiry/revoke/rate-limit built in. |
| MCP surface | **Tools + Resources + Prompts.** |
| Retrieval engine (v1) | **Approach A** — reuse existing query-embed + brute-force cosine + ILIKE keyword. Isolated behind a swappable `retrieval/` module so a later pgvector/`tsvector` upgrade is internal, not a tool-contract change. |

---

## 3. Architecture

```
External agent (MCP host)
        │  HTTPS, Authorization: Bearer <user-api-key>
        ▼
Caddy  mcp.<host>  ──►  apps/mcp  (Bun, port 3005, PM2: sirius-mcp)
        │
        ├─ auth.ts        verify Bearer key → userId   (@repo/auth apiKey plugin)
        ├─ server.ts      build a per-request McpServer bound to that userId (STATELESS)
        ├─ tools/         search_posts, full_text_search, semantic_search, get_post,
        │                 list_categories, browse_category, list_projects, browse_project,
        │                 classify_text
        ├─ resources/     sirius://post/{slug}, sirius://category/{path}
        ├─ prompts/       research_topic, cite_from_corpus, summarize_category
        └─ retrieval/     keyword.ts | semantic.ts | categories.ts   (swappable engine)
                                │
                                ▼
                        @repo/db  (owner-scoped helpers, embed-client, classifyContent)
                                │
                                ▼
                           PostgreSQL
```

**Statelessness.** The service runs MCP Streamable HTTP in **stateless mode**
(`sessionIdGenerator: undefined`). Each HTTP request is authenticated independently and a
**fresh `McpServer` instance bound to the verified `userId`** handles it, then is disposed.
This is the safest multi-tenant posture: no shared session state can leak one user's
`userId` into another user's request. (If we later need streaming server→client
notifications, we revisit stateful sessions with a `Mcp-Session-Id → userId` map.)

---

## 4. Authentication & authorization

1. **Issuing keys.** Add `apiKey()` to the `betterAuth(...)` plugin list in
   `packages/auth/src/index.ts` (alongside `admin()`, `expo()`, `nextCookies()`). Users mint
   and revoke keys from **`/settings`** in `apps/web`:
   - `POST /api/app/api-keys` → `auth.api.createApiKey({ name, userId, expiresIn? })`, returns
     the plaintext key **once**.
   - `GET /api/app/api-keys` → list the caller's keys (id, name, prefix, createdAt, lastUsedAt, expiresAt).
   - `DELETE /api/app/api-keys/[id]` → revoke.
   All session-authed (`getSessionOrNull`), owner-scoped.
2. **Verifying keys (MCP service).** `apps/mcp/src/auth.ts` extracts
   `Authorization: Bearer <key>`, calls `auth.api.verifyApiKey({ key })`, and resolves the
   owning `userId`. On failure → **HTTP 401** before any MCP handling. Rate limiting and
   expiry are enforced by the plugin.
3. **Owner scoping (defense in depth).** Every handler receives `userId` and calls only
   owner-scoped `@repo/db` helpers (`listOwnerPosts`, `getEmbeddingSceneRows(userId)`,
   `classifyContent({ ownerId })`, owner-filtered `PostEmbedding` reads). `get_post`
   additionally passes the row through `canReadPost(post, userId)` — so even a slug guessed
   for another user's post returns "not found."

---

## 5. MCP surface

### 5.1 Tools

All tool inputs are validated with **zod** schemas. All results are owner-scoped to the
authenticated `userId`. "Post summary" = `{ slug, title, excerpt, type, status, categories[],
tags[], createdAt }`. List tools return `{ items: PostSummary[], nextCursor: string | null }`.

| Tool | Input | Behavior | Returns |
| --- | --- | --- | --- |
| `search_posts` | `{ type?, status?, tag?, category?, limit?, cursor? }` | Structured **browse/filter** via `listOwnerPosts` + `buildPostWhere`. No free-text ranking. | `{ items, nextCursor }` |
| `full_text_search` | `{ query, limit?, cursor? }` | **Keyword** search; v1 = ILIKE over title/excerpt/tags (the existing `q` filter), ordered by recency. (Engine isolated — upgradeable to `tsvector` ranking.) | `{ items, nextCursor }` |
| `semantic_search` | `{ query, limit? (≤25), minScore? }` | Embed query (`embedContent([{text: queryPrefix(query)}])`) → **brute-force cosine** over the user's `PostEmbedding` rows → top-K. | `{ items: (PostSummary & { score, snippet })[] }` |
| `get_post` | `{ slug }` | Full post via `findPostBySlug`, gated by `canReadPost`. | Full post: content, excerpt, images, type, categories, tags, project, createdAt, updatedAt |
| `list_categories` | `{}` | Owner taxonomy tree from `getEmbeddingSceneRows(userId)` + `categoryChildren`, with per-node post counts (`nodeCounts`). | `{ tree: CategoryNode[] }` (path, label, description, depth, directCount, subtreeCount) |
| `browse_category` | `{ path, limit?, cursor? }` | Posts under a taxonomy node (`subtreeIndex` / `linkedPosts` over scene). | `{ category, items, nextCursor }` |
| `list_projects` | `{}` | Owner projects (`listProjects`) with post counts. | `{ projects: { id, title, description, postCount }[] }` |
| `browse_project` | `{ projectId, limit?, cursor? }` | Posts filed under a project (`listProjectPosts`). | `{ project, items, nextCursor }` |
| `classify_text` | `{ text, topK? (≤10) }` | Embed text → `classifyContent({ ownerId, contentEmbedding, ... })` → top-K taxonomy paths + best project. ("Where would this file?") | `{ categories: { path, label, score }[], project?: { id, title, score } }` |

**Tool-design notes.** Three distinct search modes are intentional and documented in each
tool's description so the agent picks correctly: `search_posts` = filtered browse,
`full_text_search` = keyword query, `semantic_search` = meaning/similarity. Projects tools
are secondary navigation. Pagination uses the repo's existing cursor convention.

### 5.2 Resources

| Resource (template) | Read handler | Content |
| --- | --- | --- |
| `sirius://post/{slug}` | `findPostBySlug` + `canReadPost` | Post rendered as Markdown (title, body, categories/tags footer, source link). MIME `text/markdown`. |
| `sirius://category/{path}` | scene queries | Category overview: description/purpose + a linked index of post slugs/titles. MIME `text/markdown`. |

**Resource listing.** `resources/list` returns the owner's posts as `sirius://post/{slug}`
entries (paginated) so a host can browse the wiki. Listing and reads are owner-scoped.

### 5.3 Prompts

| Prompt | Args | Guides the agent to… |
| --- | --- | --- |
| `research_topic` | `{ topic }` | run `semantic_search` + `browse_category`, then synthesize a grounded overview citing post slugs. |
| `cite_from_corpus` | `{ question }` | answer strictly from retrieved posts (`semantic_search` → `get_post`), citing each `sirius://post/{slug}` used; say "not in corpus" if unsupported. |
| `summarize_category` | `{ path }` | pull everything under a taxonomy node (`browse_category` → `get_post`) and summarize with citations. |

---

## 6. Retrieval module (swap seam)

`apps/mcp/src/retrieval/` is the single place that knows *how* retrieval is computed:

- `keyword.ts` — `keywordSearch(userId, query, page)` → ILIKE via `@repo/db` (v1). Upgrade path: Postgres `tsvector` + GIN with ranked ordering.
- `semantic.ts` — `semanticSearch(userId, query, k)` → `embedContent` + `queryPrefix`, load owner `PostEmbedding` rows, `cosineSimilarity`, sort top-K. Upgrade path: pgvector `vector(768)` column + HNSW index + SQL `<=>`.
- `categories.ts` — taxonomy tree + per-node post indices from the embedding scene.

Tool handlers depend only on these function signatures, so moving to pgvector/`tsvector`
(Approach B/C) is an internal change with **no tool-contract change**.

---

## 7. Deployment & ops

- **PM2.** Add a third fork process `sirius-mcp` to `ecosystem.config.cjs` (`apps/mcp`,
  `bun run start`, port **3005**, loads root `.env`).
- **Caddy.** New `mcp.<host>` (prod) site block reverse-proxying `:3005`; documented in
  `infra/caddy/`. Local dev: a portless name or direct `:3005` (no public surface needed for
  dev). The MCP service has no browser UI.
- **Env.** Reuses root `.env`: `DATABASE_URL`, `GEMINI_API_KEY` (for query embedding),
  `BETTER_AUTH_SECRET`, plus a new `MCP_PORT` (default 3005). Add any new vars to
  `turbo.json` `globalEnv` if they affect builds.
- **Scripts.** `apps/mcp/package.json`: `dev` (`bun run --watch src/index.ts`), `start`
  (`bun run src/index.ts`), `check-types`, `lint`. No build step (matches `apps/worker`).
- **Workspace wiring.** New `apps/mcp` added to the bun workspace; depends on `@repo/db`,
  `@repo/auth`, `@repo/embedding-scene`, plus `@modelcontextprotocol/sdk` and `zod`.

---

## 8. Error handling

- **Auth:** missing/invalid/expired key → HTTP 401 with `WWW-Authenticate`. Never reveal whether a key exists.
- **Tool input:** zod validation failure → MCP tool error result (`isError: true`) with a clear message; no stack traces.
- **Not found / no access:** `get_post`/resources return a uniform "not found" (no distinction between "doesn't exist" and "not yours").
- **Upstream (Gemini embed) failure:** `semantic_search`/`classify_text` return a graceful tool error ("semantic search temporarily unavailable") rather than crashing the request.
- **Rate limiting:** handled by the better-auth `apiKey()` plugin; over-limit → MCP error surfaced to the agent.

---

## 9. Testing & verification

The repo has **no test runner** (per CLAUDE.md). Verification is manual and scripted:

1. **MCP Inspector** — `bunx @modelcontextprotocol/inspector`, connect to the local
   Streamable HTTP endpoint with a dev API key; confirm tools/resources/prompts list and
   each tool returns owner-scoped data.
2. **Smoke client** — a small `apps/mcp/scripts/smoke.ts` using `@modelcontextprotocol/sdk`
   client that: lists tools, runs `semantic_search`/`full_text_search`/`get_post`, reads a
   `sirius://post/{slug}` resource, and asserts results are non-empty for the dev user.
3. **Tenant-isolation check** — with user A's key, attempt user B's slug → expect "not
   found"; confirm `semantic_search` never returns B's posts. This is the critical
   security assertion.
4. **Auth checks** — no key → 401; revoked key → 401; expired key → 401.

Document the runbook in `apps/mcp/README.md`.

---

## 10. Out of scope (YAGNI / future)

- pgvector ANN + `tsvector` ranked FTS (Approach B) and RRF hybrid fusion (Approach C) —
  enabled later behind the `retrieval/` seam without changing tools.
- Writing/mutating the corpus via MCP (this server is **read-only**).
- Cross-user / public-catalog wiki (current PUBLIC_CATALOG is off; out of scope).
- Streaming notifications / stateful MCP sessions.
- Per-key scopes finer than "this user's read-only corpus."

---

## 11. Build sequence (high level)

1. Add `apiKey()` to `@repo/auth`; migrate (better-auth apiKey table) via the repo's
   hand-authored-SQL + `migrate deploy` flow.
2. API-key management endpoints + minimal `/settings` UI in `apps/web`.
3. Scaffold `apps/mcp` (Bun + MCP SDK Streamable HTTP, stateless) with `auth.ts`.
4. `retrieval/` module (keyword, semantic, categories).
5. Tools → Resources → Prompts.
6. PM2 + Caddy wiring; `README.md` runbook.
7. Manual verification (Inspector + smoke + tenant-isolation).
