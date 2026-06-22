# apps/mcp — MCP corpus server

A standalone Bun HTTP service that exposes **each user's own post corpus** to
external AI agents over the [Model Context Protocol](https://modelcontextprotocol.io)
(Streamable HTTP). A connected agent can search, semantically retrieve, navigate
the taxonomy/projects, classify text, and read posts as wiki-like context.

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

## Deploy

- **PM2:** `sirius-mcp` in `ecosystem.config.cjs` (fork mode, `bun run start`,
  `MCP_PORT=3005`).
- **Caddy:** `mcp.lesswhelmed.com` site block reverse-proxying `:3005`
  (`infra/caddy/Caddyfile` + README merge steps). Needs its own DNS A record.
- **Migration:** the `apikey` table the `apiKey()` plugin needs ships as a
  hand-authored SQL migration under `packages/db/prisma/migrations/`. Apply it
  with `bun run db:migrate:deploy` on each environment (a documented **manual**
  step — not auto-applied).
