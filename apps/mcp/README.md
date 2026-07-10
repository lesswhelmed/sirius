# apps/mcp — MCP corpus server

A standalone Bun HTTP service that exposes **each user's own post corpus** to
external AI agents over the [Model Context Protocol](https://modelcontextprotocol.io)
(Streamable HTTP). A connected agent can search, semantically retrieve, navigate
the taxonomy/projects, classify text, and read posts as wiki-like context.

**Why it exists:** let users connect their *own* external LLM chats/agents
(Claude, ChatGPT, etc.) to their Lesswhelmed corpus, so the content they've ingested
becomes usable context wherever they work — closing the loop between capture and
use. **Status: WIP / not fully fleshed out** — the read surface below is live and
validated, but the product around it (key management UX, richer write/curation
flows, discovery) is still being built.

A ready client lives in this repo: the **`sirius-research` Claude Code plugin**
(`plugins/sirius-research/`) connects to this server and adds research skills +
a blackbox smoke harness — see its README.

Design: `docs/superpowers/specs/2026-06-21-mcp-server-design.md`.

## How it works

- **Per-user, multi-tenant.** Every request carries `Authorization: Bearer
  <user-api-key>`. The key is verified against the better-auth `apiKey()` plugin
  in `@repo/auth` (no HTTP round-trip — `auth.api.verifyApiKey` off the imported
  instance) and resolves to the owning `userId` (`result.key.referenceId`). On
  any failure → **HTTP 401** before any MCP handling.
- **Stateless.** Each request builds a **fresh `McpServer` bound to that userId**,
  connected to a `WebStandardStreamableHTTPServerTransport` with
  `sessionIdGenerator: undefined`, handles the one request, then disposes both.
  No shared per-user state can leak one user's `userId` into another's request.
- **Owner-scoped, defense in depth.** Every handler only calls owner-scoped
  `@repo/db` helpers (`listOwnerPosts`, `getEmbeddingSceneRows(userId)`,
  `classifyContent({ ownerId })`, owner-filtered embedding rows). `get_post` and
  the resources additionally gate on `post.submittedById === userId`, so a slug
  guessed for another user's post returns a uniform **"not found"**.
- **Read-only.** No tool mutates the corpus.

## Surface

**Tools** (zod-validated inputs; three distinct search modes):
`search_posts` (structured browse/filter), `full_text_search` (keyword/ILIKE),
`semantic_search` (meaning/cosine), `get_post`, `list_categories`,
`browse_category`, `list_projects`, `browse_project`, `classify_text`.

**Resources:** `sirius://post/{slug}` (post → Markdown) and
`sirius://category/{path}` (category overview + linked index). `resources/list`
enumerates the owner's posts.

**Prompts:** `research_topic`, `cite_from_corpus`, `summarize_category`.

## Run locally

```sh
bun --cwd apps/mcp dev      # bun run --watch src/index.ts  (port MCP_PORT, default 3005)
bun --cwd apps/mcp start    # production entry
```

Reads the repo-root `.env` (via the `.env` symlink): `DATABASE_URL`,
`GEMINI_API_KEY` (query/classify embedding), `BETTER_AUTH_SECRET`, and
`MCP_PORT`. Endpoints: `POST /` or `POST /mcp` (MCP Streamable HTTP),
`GET /health` (unauthenticated liveness).

## Get an API key

Sign in to the web app, open `/settings` → **API Keys**, mint a key (copy the
plaintext shown **once**). Or `POST /api/app/api-keys` while session-authed.

Minted keys carry a default rate limit of **1000 requests / hour** (each MCP
request = one `verifyApiKey` = one unit; a single research run fans out to
dozens). The default is set at mint in
`apps/web/app/api/app/api-keys/route.ts` (`MCP_API_KEY_RATE_LIMIT_*` constants).
The window resets lazily — a key that returns `401` becomes usable again on the
first request after the window elapses since its last request. (The
`apiKey()` plugin's own default is 10/day, which is far too low for research;
that's why we override it at mint. Keys minted before this override keep 10/day
until backfilled.)

## Verify (manual — no test runner in this repo)

1. **MCP Inspector**

   ```sh
   bunx @modelcontextprotocol/inspector
   ```

   Connect transport "Streamable HTTP" to `http://localhost:3005/mcp`, set header
   `Authorization: Bearer <key>`, then confirm tools/resources/prompts list and
   each tool returns owner-scoped data.

2. **Smoke client**

   ```sh
   MCP_SMOKE_KEY=<plaintext-key> bun --cwd apps/mcp smoke
   # optional: MCP_SMOKE_URL=http://localhost:3005/mcp
   ```

   Lists tools/resources/prompts, runs the search tools + `get_post`, reads a
   `sirius://post/{slug}` resource.

3. **Tenant isolation (the critical security check)** — with user A's key, call
   `get_post`/`browse_category` with a slug/path you know belongs to user B:
   expect **"not found"**; confirm `semantic_search` never returns B's posts.

4. **Auth** — no key, revoked key, expired key → all **401**.

> **Validated 2026-06-24.** The end-to-end key smoke (all 9 tools / 2 resources
> / 3 prompts), tenant isolation (foreign slug → `not found`; `semantic_search`
> returns only owner posts), and rate-limit enforcement all pass. The reusable
> harness is `plugins/sirius-research/scripts/smoke.sh`
> (`SIRIUS_MCP_API_KEY=<key> bash plugins/sirius-research/scripts/smoke.sh`).
> Note local dev uses `MCP_PORT=4269` in this repo's `.env` (the `:3005` in the
> examples above is the upstream default + the prod/Caddy port).

## Deploy

- **PM2:** `sirius-mcp` in `ecosystem.config.cjs` (fork mode, `bun run start`,
  `MCP_PORT=3005`).
- **Caddy:** `mcp.lesswhelmed.com` site block reverse-proxying `:3005`
  (`infra/caddy/Caddyfile` + README merge steps). Needs its own DNS A record.
- **Migration:** the `apikey` table the `apiKey()` plugin needs ships as a
  hand-authored SQL migration under `packages/db/prisma/migrations/`. Apply it
  with `bun run db:migrate:deploy` on each environment (a documented **manual**
  step — not auto-applied).
