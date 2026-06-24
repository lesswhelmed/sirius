# sirius-research — Claude Code plugin

Gives Claude the ability to **read and research a Sirius user's own post
corpus** on demand — semantic + keyword + structured search, full-post reading,
and taxonomy/project navigation — with **structured input/output**. It is the
Claude-Code-plugin face of the [`apps/mcp`](../../apps/mcp) corpus server: the
plugin connects to that server over MCP (so it inherits the server's
owner-scoped, read-only, multi-tenant-safe tools) and adds skills that direct
Claude *when and how* to use them.

## What's inside

| Component | What it is |
|-----------|------------|
| `.mcp.json` | Connects to the `sirius-corpus` MCP server (Streamable HTTP, Bearer API key). Surfaces all **9 tools, 2 resources, 3 prompts**. |
| `skills/sirius-research` | Master skill: when to research the corpus, how to pick a search mode, the citation contract. Detailed structured I/O in `references/tool-catalog.md`. |
| `skills/deep-corpus-research` | Orchestration: exhaustive multi-mode research loop → structured, cited report. |
| `skills/research-topic` | Quick grounded topic overview (mirrors the `research_topic` prompt). |
| `skills/cite-from-corpus` | Answer strictly from the corpus, with citations or `not in corpus` (mirrors `cite_from_corpus`). |
| `skills/summarize-category` | Paginate + summarize a whole taxonomy node (mirrors `summarize_category`). |
| `scripts/smoke.ts` / `smoke.sh` | Blackbox test: exercises every tool/resource/prompt and asserts the structured output shapes. |

### The 9 tools

`search_posts` (structured filter), `full_text_search` (keyword/ILIKE),
`semantic_search` (meaning/cosine), `get_post`, `list_categories`,
`browse_category`, `list_projects`, `browse_project`, `classify_text`. Plus
resources `sirius://post/{slug}` and `sirius://category/{path}`, and prompts
`research_topic` / `cite_from_corpus` / `summarize_category`.

## Setup

1. **Run the corpus server** (dev):
   ```sh
   bun --cwd apps/mcp dev      # listens on http://localhost:4269 in this repo (MCP_PORT; upstream default 3005)
   ```
   To point at production instead, change `url` in `.mcp.json` to
   `https://mcp.lesswhelmed.com/mcp`.

2. **Mint an API key** for the account whose corpus you want to research:
   sign in to the web app → `/settings` → **API Keys** (copy the plaintext once),
   or `POST /api/app/api-keys` while session-authed. The key determines whose
   corpus is visible — it is owner-scoped.

3. **Export the key** so the plugin can authenticate:
   ```sh
   export SIRIUS_MCP_API_KEY=<plaintext-key>
   ```

4. **Load the plugin** and verify the tools are live:
   ```sh
   claude --plugin-dir plugins/sirius-research
   /mcp        # confirm the sirius-corpus server + its tools appear
   ```

## Required environment variables

| Var | Purpose |
|-----|---------|
| `SIRIUS_MCP_API_KEY` | **Required.** Plaintext Sirius API key (Bearer). Owner-scopes every call. |
| `SIRIUS_MCP_URL` | Optional. MCP endpoint (default `http://localhost:4269/mcp`). Used by the smoke script; the plugin's live endpoint is set in `.mcp.json`. |

No secrets are committed — the key is read from the environment.

## Usage

Once loaded, Claude uses the corpus automatically when asked to research the
user's own material ("what have I written about X", "research my posts on Y",
"read post `<slug>`"). Or invoke a recipe directly:

- `/sirius-research:deep-corpus-research <topic>` — exhaustive cited synthesis
- `/sirius-research:research-topic <topic>` — quick grounded overview
- `/sirius-research:cite-from-corpus <question>` — answer strictly from corpus
- `/sirius-research:summarize-category <path>` — summarize a taxonomy node

## Blackbox test

```sh
SIRIUS_MCP_API_KEY=<key> bash plugins/sirius-research/scripts/smoke.sh
```

Probes `/health`, then runs `smoke.ts`, which: lists tools/resources/prompts
(asserts all 9 + 3 present), runs all three search modes, walks the taxonomy and
projects, reads a full post + its Markdown resource, and runs an auth-negative
check (a bogus key must get no corpus access). Exits non-zero on any failed
assertion.

## Guarantees inherited from the server

- **Read-only** — no tool mutates the corpus.
- **Owner-scoped** — a slug/path belonging to another user returns `not found`;
  `semantic_search` never returns another user's posts.
- **Structured I/O** — every tool input is Zod-validated; outputs are structured
  JSON (see `skills/sirius-research/references/tool-catalog.md`).

## Notes

- `http://localhost:4269` is plain HTTP for **local dev only**. The production
  endpoint (`mcp.lesswhelmed.com`) is HTTPS.
- The exact MCP tool prefix is
  `mcp__plugin_sirius-research_sirius-corpus__<tool>`; confirm with `/mcp`.
