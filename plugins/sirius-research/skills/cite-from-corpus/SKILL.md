---
name: Cite from corpus
description: This skill should be used when the user asks to "/sirius-research:cite-from-corpus", "answer this strictly from my posts", "what does my corpus say about <question>", or wants an answer grounded only in their Sirius corpus with citations (and an explicit "not in corpus" when unsupported). Mirrors the server's cite_from_corpus prompt.
argument-hint: <question to answer strictly from the corpus>
allowed-tools: ["mcp__plugin_sirius-research_sirius-corpus__semantic_search", "mcp__plugin_sirius-research_sirius-corpus__full_text_search", "mcp__plugin_sirius-research_sirius-corpus__get_post", "mcp__plugin_sirius-research_sirius-corpus__*"]
version: 0.1.0
---

# Cite from corpus

Answer the supplied question **strictly from the user's Sirius corpus**, with a
citation for every claim. For tool schemas see
`../sirius-research/references/tool-catalog.md`.

Confirm the `sirius-corpus` server is reachable and `SIRIUS_MCP_API_KEY` is set
(`/mcp`); on failure, report it.

## Procedure

1. `semantic_search` for candidate posts. Add `full_text_search` for any exact
   terms/names in the question.
2. Read promising posts with `get_post { slug }` or the `sirius://post/{slug}`
   resource.
3. Answer **only** from what the corpus supports. Cite each supporting post as
   `sirius://post/<slug>` (or `(post: <slug>)`).
4. If the corpus does not support an answer, reply **exactly**: `not in corpus`.
   Do not supplement with general knowledge.
