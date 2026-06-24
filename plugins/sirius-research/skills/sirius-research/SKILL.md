---
name: Sirius corpus research
description: This skill should be used when the user asks to "research my posts", "search my Sirius corpus", "what have I written about X", "find posts about X", "read my post <slug>", "cite from my corpus", "summarize my <category> posts", "what does my corpus say about X", or otherwise wants to read, search, or ground an answer in their own Sirius post corpus. Provides the structured-input/output contract for the sirius-corpus MCP tools (semantic/keyword/structured search, full-post reading, taxonomy + project navigation, classification) and the rules for using them.
version: 0.1.0
---

# Sirius corpus research

Ground answers in the user's **own Sirius post corpus** via the `sirius-corpus`
MCP server (bundled with this plugin; mirrors `apps/mcp`). The server is
**read-only** and **owner-scoped** — every call resolves to the owner of the
configured API key, and content belonging to anyone else returns `not found`.

Invoke this skill whenever the user directs Claude to leverage their Sirius
material: searching, reading posts, navigating their taxonomy/projects, or
answering a question strictly from what they have captured.

## Prerequisites (one-time)

The tools only work once the MCP server is reachable and authenticated:

1. The `sirius-corpus` server must be running and configured. In dev it listens
   on `http://localhost:<MCP_PORT>/mcp` — this repo's `.env` sets
   `MCP_PORT=4269` (the upstream default is 3005). Start it with
   `bun --cwd apps/mcp dev`; `.mcp.json` targets `:4269`.
2. The env var **`SIRIUS_MCP_API_KEY`** must hold a Sirius API key (minted in
   the web app at `/settings` → API Keys, or `POST /api/app/api-keys` while
   signed in). The key determines whose corpus is searched.
3. Confirm the tools are live with `/mcp` — they appear under the
   `sirius-corpus` server, named
   `mcp__plugin_sirius-research_sirius-corpus__<tool>`.

If a call returns an auth/connection error, stop and report that the server is
down or `SIRIUS_MCP_API_KEY` is missing/invalid rather than guessing answers.

## Choosing a search mode

Three search tools match differently — pick deliberately:

- **`semantic_search`** — meaning/relevance (cosine over embeddings). The
  default for open-ended research ("what have I been thinking about re X").
  Returns a relevance `score` and a `snippet` per hit.
- **`full_text_search`** — literal keyword/phrase (title, excerpt, tag names).
  Use for exact names/terms semantic ranking might miss.
- **`search_posts`** — structured filter by `type`/`status`/`tag`/`category`,
  no ranking. Use to enumerate everything of a kind.

To navigate by structure instead of query: `list_categories` →
`browse_category` (taxonomy), or `list_projects` → `browse_project` (focus
areas). To locate where a piece of text belongs, use `classify_text`.

## The core loop

1. **Find** candidates — `semantic_search` first; add `full_text_search` for
   exact strings; use `browse_category`/`browse_project` when the user names a
   topic/project. Every result carries a `slug`.
2. **Read** the promising ones — `get_post { slug }` for full body, or read the
   `sirius://post/{slug}` resource as Markdown.
3. **Answer** strictly from what was read, **citing each claim** by slug as
   `(post: <slug>)`.
4. If nothing relevant comes back, say so — reply `not in corpus` rather than
   filling the gap from model priors.

## Structured input/output

All tool inputs are Zod-validated (invalid input is rejected before the
handler), and outputs are structured JSON. Respect the documented bounds (e.g.
`semantic_search.limit` is 1–25; `search_posts.limit` is 1–100). Paginate with
`cursor`/`nextCursor` until `nextCursor` is null when completeness matters
(e.g. summarizing a whole category). The full per-tool schema (inputs, outputs,
shared `PostSummary`/`FullPost`/`CategoryNode` shapes, resources, and prompts)
is in **`references/tool-catalog.md`** — read it before composing non-trivial
calls.

## Owner-scoping & honesty

- Never claim coverage the corpus does not have. Empty results are a valid,
  informative answer.
- Do not attempt to reach other users' posts; foreign slugs/paths return
  `not found` by design.
- The corpus is the source of truth for "what the user has written" — prefer it
  over general knowledge when the question is about their own material.

## Related skills

For richer workflows layered on these tools:

- **`/sirius-research:deep-corpus-research`** — exhaustive multi-tool research
  loop producing a structured, cited report.
- **`/sirius-research:research-topic`** — quick grounded overview of a topic.
- **`/sirius-research:cite-from-corpus`** — answer one question strictly from
  the corpus, with citations or `not in corpus`.
- **`/sirius-research:summarize-category`** — paginate and summarize a whole
  taxonomy node.

## Additional resources

- **`references/tool-catalog.md`** — complete structured I/O contract for all 9
  tools, 2 resources, and 3 prompts, plus the citation contract.
