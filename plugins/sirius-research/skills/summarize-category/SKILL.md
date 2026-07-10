---
name: Summarize a corpus category
description: This skill should be used when the user asks to "/sirius-research:summarize-category", "summarize my <category> posts", "what's in my <topic> category", or wants a structured summary of every post filed under a taxonomy node in their Lesswhelmed corpus. Mirrors the server's summarize_category prompt.
argument-hint: <category path to summarize>
allowed-tools: ["mcp__plugin_sirius-research_sirius-corpus__list_categories", "mcp__plugin_sirius-research_sirius-corpus__browse_category", "mcp__plugin_sirius-research_sirius-corpus__get_post", "mcp__plugin_sirius-research_sirius-corpus__*"]
version: 0.1.0
---

# Summarize a corpus category

Produce a structured summary of every post under a taxonomy node. For tool
schemas see `../sirius-research/references/tool-catalog.md`.

Confirm the `sirius-corpus` server is reachable and `SIRIUS_MCP_API_KEY` is set
(`/mcp`); on failure, report it.

## Procedure

1. If the exact category `path` is unknown, call `list_categories` and pick the
   node whose `label`/`path` matches the user's request.
2. `browse_category { path }`, **paginating through `nextCursor` until null** so
   the summary covers the whole node and its subtree.
3. Read each post with `get_post { slug }` or the `sirius://post/{slug}`
   resource.
4. Write a structured summary: group related posts into themes, cite each as
   `(post: <slug>)`, and note gaps or recurring themes.
5. If the path is not a node in the user's taxonomy, report `not found`.
