---
name: Deep corpus research
description: This skill should be used when the user asks to "deeply research my posts about X", "do a thorough corpus research on X", "/sirius-research:deep-corpus-research", "synthesize everything I've written about X", or wants an exhaustive, cited synthesis drawn from their Sirius corpus across multiple search modes. Runs a multi-pass research loop (semantic + keyword + taxonomy) and emits a structured, cited report.
argument-hint: <topic or question to research across the corpus>
allowed-tools: ["mcp__plugin_sirius-research_sirius-corpus__semantic_search", "mcp__plugin_sirius-research_sirius-corpus__full_text_search", "mcp__plugin_sirius-research_sirius-corpus__search_posts", "mcp__plugin_sirius-research_sirius-corpus__get_post", "mcp__plugin_sirius-research_sirius-corpus__list_categories", "mcp__plugin_sirius-research_sirius-corpus__browse_category", "mcp__plugin_sirius-research_sirius-corpus__list_projects", "mcp__plugin_sirius-research_sirius-corpus__browse_project", "mcp__plugin_sirius-research_sirius-corpus__classify_text", "mcp__plugin_sirius-research_sirius-corpus__*"]
version: 0.1.0
---

# Deep corpus research

Produce an exhaustive, **cited** synthesis of what the user's Sirius corpus says
about a topic or question, drawing from multiple search modes so coverage does
not depend on a single query angle. The argument is the topic/question to
research.

This skill orchestrates the `sirius-corpus` tools. Read
`../sirius-research/references/tool-catalog.md` for the exact structured I/O of
each tool before composing calls. Confirm the server is reachable (`/mcp`) and
`SIRIUS_MCP_API_KEY` is set; on auth/connection failure, stop and report it.

## Procedure

1. **Frame.** Restate the topic and derive 2–4 distinct query phrasings
   (synonyms, narrower/broader framings). Diversity of phrasing widens recall.

2. **Multi-modal find (breadth).** Run, and merge the results of:
   - `semantic_search` for each phrasing (`limit` up to 25).
   - `full_text_search` for any exact terms/names in the topic.
   - `list_categories`, then `browse_category` on any node whose label matches
     the topic (paginate via `nextCursor`).
   - Optionally `classify_text` on the topic text to discover the best-matching
     category/project, then `browse_category`/`browse_project` those.
   Deduplicate candidates by `slug`. Keep a note of which mode surfaced each.

3. **Read (depth).** `get_post { slug }` for the most relevant candidates
   (prioritize high semantic `score` and category matches). Read enough to
   support the synthesis — do not synthesize from snippets alone.

4. **Synthesize.** Group related posts into themes. Make every claim traceable
   to a post via `(post: <slug>)`. Note tensions/evolution across posts where
   they exist.

5. **Report gaps.** Explicitly list what the corpus does *not* cover for this
   topic, and which search modes returned nothing. Never pad with model priors.

## Output — structured report

Emit the synthesis as Markdown sections, then a machine-readable findings block.
Keep prose grounded; the JSON block makes the result consumable downstream.

```
## Summary
<2–4 sentence grounded overview>

## Themes
### <theme>
<synthesis with inline (post: slug) citations>

## Gaps
<what the corpus does not cover; which modes were empty>

## Findings (structured)
```json
{
  "topic": "<the researched topic>",
  "themes": [
    { "title": "<theme>", "summary": "<1–2 sentences>",
      "citations": [{ "slug": "<slug>", "title": "<post title>", "quote": "<short supporting quote>" }] }
  ],
  "postsRead": ["<slug>", "..."],
  "modesUsed": ["semantic_search", "full_text_search", "browse_category", "..."],
  "gaps": ["<gap or empty-mode note>", "..."],
  "corpusSupported": true
}
```
```

If the corpus yields nothing relevant, set `corpusSupported: false`, leave
`themes` empty, and say so in the Summary rather than answering from general
knowledge.

## Scope notes

- Owner-scoped: only the API-key owner's posts are visible.
- Read-only: this never mutates the corpus.
- When the user wants a quick answer rather than a full report, prefer
  `/sirius-research:research-topic` or `/sirius-research:cite-from-corpus`.
