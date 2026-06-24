# Sirius corpus — structured tool/resource/prompt catalog

The `sirius-corpus` MCP server (mirrors `apps/mcp`) is **read-only** and
**owner-scoped**: every call resolves to the user who owns the API key, and a
slug/path belonging to another user returns a uniform `not found`. All tool
inputs are Zod-validated; invalid input is rejected before the handler runs.

## Tool name prefix

Plugin-bundled MCP tools are exposed to Claude as:

```
mcp__plugin_sirius-research_sirius-corpus__<tool>
```

e.g. `mcp__plugin_sirius-research_sirius-corpus__semantic_search`. The exact
prefix is confirmable at runtime with the `/mcp` command. Throughout this
catalog tools are referred to by their **base name** (`semantic_search`,
`get_post`, …).

## Three distinct search modes — pick deliberately

| Tool | Matching | Use when |
|------|----------|----------|
| `semantic_search` | meaning / cosine similarity over embeddings | the query is conceptual ("what have I written about burnout"); ranks by relevance, returns score + snippet |
| `full_text_search` | literal keyword/phrase (ILIKE on title, excerpt, tag names) | an exact term/name/phrase must appear; ordered by recency |
| `search_posts` | structured filter (type/status/tag/category) | browsing/enumerating by known facets, no ranking |

Default to `semantic_search` for open-ended research. Fall back to
`full_text_search` for exact strings semantic misses. Use `search_posts` to
page through everything of a kind.

---

## Tools

### `semantic_search`
Find posts by meaning, ranked by cosine similarity.
- **Input:** `{ query: string (≥1), limit?: int 1–25 (default 10), minScore?: number 0–1 }`
- **Output:** `{ items: SemanticHit[] }` where
  `SemanticHit = PostSummary & { score: number, snippet: string }`
- **Notes:** embeds the query via Gemini; if embeddings are unavailable the tool
  returns a graceful error result (not a crash). Empty `items` = nothing
  relevant in the corpus (say so; don't invent).

### `full_text_search`
Literal keyword/phrase search over title, excerpt, and tag names.
- **Input:** `{ query: string (≥1), limit?: int 1–100, cursor?: string }`
- **Output:** `{ items: PostSummary[], nextCursor: string | null }`

### `search_posts`
Structured browse/filter — no free-text ranking.
- **Input:** `{ type?: "CONCRETE"|"BLOG"|"FINDING"|"SIGHT"|"SOCIAL", status?: "PUBLISHED"|"DRAFT"|"ARCHIVED", tag?: string (slug), category?: string (slug), limit?: int 1–100 (default 25), cursor?: string }`
- **Output:** `{ items: PostSummary[], nextCursor: string | null }`

### `get_post`
Fetch one post's full content by slug. The primary **post-reading** tool.
- **Input:** `{ slug: string (≥1) }`
- **Output:** `FullPost` or `not found`:
  ```
  { slug, title, content, excerpt|null, type, status, imageUrl|null, images,
    originalUrl|null, categories: {slug,name}[], tags: {slug,name}[],
    projectId|null, createdAt (ISO), updatedAt (ISO) }
  ```

### `list_categories`
The user's topic taxonomy as a nested tree with per-node counts.
- **Input:** `{}` (none)
- **Output:** `{ tree: CategoryNode[] }` where
  `CategoryNode = { path, label, description|null, depth, directCount, subtreeCount, children: CategoryNode[] }`
  (`directCount` = posts matched to this node; `subtreeCount` = node + descendants)

### `browse_category`
List posts filed under a taxonomy node and its subtree.
- **Input:** `{ path: string (≥1), limit?: int 1–100, cursor?: string }`
- **Output:** `CategoryBrowse | not found`:
  `{ category: {path,label,description|null}, items: (PostSummary & {score?})[], nextCursor: string|null }`

### `list_projects`
The user's projects ("focus areas") with post counts — a navigation axis
distinct from the taxonomy.
- **Input:** `{}` (none)
- **Output:** `{ projects: { id, title, description|null, postCount }[] }`

### `browse_project`
List posts filed under a project by id.
- **Input:** `{ projectId: string (≥1), limit?: int 1–100, cursor?: string }`
- **Output:** `ProjectBrowse | not found`:
  `{ project: {id,title,description|null}, items: PostSummary[], nextCursor: string|null }`

### `classify_text`
Given arbitrary text, return matching taxonomy categories + best project
("where would this file?"). Useful to locate the part of the corpus a draft or
idea belongs to.
- **Input:** `{ text: string (≥1), topK?: int 1–10 (default 5) }`
- **Output:** `{ categories: { path, label, score }[], project?: { id, title, score } }`
  or a graceful "semantic search temporarily unavailable" error.

### Shared shape — `PostSummary`
Returned by every list/search tool (exact fields may include):
`{ slug, title, excerpt|null, type, status, createdAt, ... }`. Always carries a
`slug` — the key to read the full post with `get_post`.

---

## Resources

Resources render corpus objects as Markdown (good for direct inclusion as
context). Read via the resource API, not a tool call.

- **`sirius://post/{slug}`** → a post as Markdown (title, excerpt, body,
  category/tag/source footer). `resources/list` enumerates the owner's posts
  (50/page). `text/markdown`.
- **`sirius://category/{path}`** → category overview + a linked index of posts
  under the node. List op disabled (direct-access by known path). `text/markdown`.

Both gate on ownership; unknown/foreign slug or path → `not found`.

---

## Prompts (server-side recipes)

The server also exposes guided prompts (visible via `/mcp` as
`research_topic`, `cite_from_corpus`, `summarize_category`). The plugin
re-expresses these as invocable skills (`/sirius-research:research-topic`, etc.)
so they work as slash commands; either path drives the same tools.

- `research_topic({ topic })` — semantic_search → list/browse categories →
  get_post → grounded overview citing `(post: slug)`.
- `cite_from_corpus({ question })` — search → read → answer strictly from corpus,
  cite `sirius://post/{slug}`; if unsupported, reply exactly `not in corpus`.
- `summarize_category({ path })` — page browse_category to exhaustion → read →
  structured summary grouping related posts, citing `(post: slug)`.

---

## Citation contract

Every claim drawn from the corpus must cite the source post by slug, as
`(post: <slug>)` or the resource URI `sirius://post/<slug>`. If the corpus does
not support an answer, state that plainly (`not in corpus`) rather than filling
the gap with model priors.
