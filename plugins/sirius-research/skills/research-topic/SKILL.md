---
name: Research a corpus topic
description: This skill should be used when the user asks to "/sirius-research:research-topic", "research <topic> in my posts", "give me an overview of what I've written about <topic>", or wants a quick grounded overview of a topic from their Sirius corpus. Mirrors the server's research_topic prompt.
argument-hint: <topic to overview from the corpus>
allowed-tools: ["mcp__plugin_sirius-research_sirius-corpus__semantic_search", "mcp__plugin_sirius-research_sirius-corpus__list_categories", "mcp__plugin_sirius-research_sirius-corpus__browse_category", "mcp__plugin_sirius-research_sirius-corpus__get_post", "mcp__plugin_sirius-research_sirius-corpus__*"]
version: 0.1.0
---

# Research a corpus topic

Give a concise, grounded overview of what the user's Sirius corpus says about
the supplied topic. For an exhaustive multi-mode synthesis instead, use
`/sirius-research:deep-corpus-research`. For tool schemas see
`../sirius-research/references/tool-catalog.md`.

Confirm the `sirius-corpus` server is reachable and `SIRIUS_MCP_API_KEY` is set
(`/mcp`); on failure, report it rather than answering from general knowledge.

## Procedure

1. `semantic_search` the topic to find the most relevant posts.
2. `list_categories` and `browse_category` on any node matching the topic to
   pull additional posts the query may have missed.
3. `get_post { slug }` (or read `sirius://post/{slug}`) for the most relevant
   posts.
4. Write a short, grounded overview. **Cite each claim** by slug as
   `(post: <slug>)`.
5. If the corpus has little or nothing on the topic, say so explicitly.
