# Sirius Research, in Plain English

> **A gentle research companion for finding, understanding, and responsibly summarizing your own writing.**
>
> Sirius Research connects Claude to a private corpus of Lesswhelmed posts. It can look across your material by meaning, words, categories, or projects, then bring the relevant passages back with enough structure and context to support a trustworthy summary.

## The short version

Think of this module as a thoughtful librarian for your personal writing. You ask a natural question such as **“What have I written about attention and overwhelm?”** Sirius searches the corpus in the way that best fits the question, reads the useful material, and helps produce a clear answer grounded in what is actually there.

It is not a generic web search engine, and it does not invent a personal archive. Its job is narrower and more useful: **helping you make sense of your own words.**

## What it provides

### 1. Three complementary ways to search

- **Structured search** finds posts using explicit filters such as dates, categories, projects, or other supported fields.
- **Full-text search** looks for exact words and phrases. This is useful when you remember a term, sentence, or distinctive expression.
- **Semantic search** looks for meaning rather than exact wording. It can find writing about “rest and recovery” even when the post uses different language.

Using these together is important. Exact search is precise; semantic search is generous; structured search gives the work shape and boundaries.

### 2. Full-post reading

Once a promising result is found, Sirius can retrieve the complete post rather than relying on a small search snippet. This helps preserve the author’s actual context, qualifications, examples, and tone.

### 3. Taxonomy and project navigation

The module can show available categories, browse a category, list projects, and browse a project. This makes it possible to explore a body of work intentionally instead of treating every post as an isolated result.

### 4. Text classification

`classify_text` can help identify how a piece of text relates to the corpus’ existing organization. In everyday terms, it can suggest where a passage belongs within the known themes and projects.

### 5. Reusable research recipes

The module includes four human-friendly skills:

- **Research topic** — a quick, grounded overview of a subject.
- **Deep corpus research** — a broader, multi-pass investigation that combines search modes into a cited synthesis.
- **Cite from corpus** — an answer constrained to the corpus, with citations or a clear statement that the answer was not found.
- **Summarize category** — a summary of a complete taxonomy branch, gathered across its pages rather than inferred from one item.

## The nine tools, without jargon

| Tool | Plain-English job |
| --- | --- |
| `search_posts` | Find posts using structured filters. |
| `full_text_search` | Find posts containing words or phrases. |
| `semantic_search` | Find posts that discuss a similar idea. |
| `get_post` | Read one complete post. |
| `list_categories` | See the available taxonomy. |
| `browse_category` | Explore posts within one category. |
| `list_projects` | See the available projects. |
| `browse_project` | Explore posts within one project. |
| `classify_text` | Relate new text to the corpus’ organization. |

It also exposes two readable resources for individual posts and categories, plus three guided prompts for topic research, corpus-only citation, and category summaries.

## What a good summary looks like

A strong Sirius summary should feel like a map, not a verdict. It can include:

1. **The central idea** — what the writing consistently seems to say.
2. **The supporting themes** — the recurring ideas, practices, tensions, or examples.
3. **The range of views** — where the corpus agrees, changes its mind, or holds more than one perspective.
4. **The evidence** — post titles, slugs, or citations that let a reader follow the trail.
5. **The boundaries** — what the corpus does not establish, what was ambiguous, and what was not found.
6. **The practical takeaway** — a plain-language interpretation that remains faithful to the source material.

The goal is not to flatten a nuanced body of work into one slogan. The goal is to make the pattern visible while respecting the details that created it.

## The trust and privacy model

Sirius Research is designed around a few straightforward promises:

- **Read-only:** the research tools do not modify the corpus.
- **Owner-scoped:** the API key determines whose corpus can be seen. A request cannot use one person’s key to browse another person’s writing.
- **Structured:** inputs are validated and outputs follow predictable JSON shapes.
- **Cited:** research workflows are instructed to show where conclusions came from.
- **Honest about absence:** corpus-only answers should say `not in corpus` when the material does not support an answer, rather than filling the gap with guesswork.

These safeguards do not make interpretation magically objective. They do make the path from question to source material easier to inspect and discuss.

## Installing and using it

The module is a Claude Code plugin. From the repository root:

```sh
claude --plugin-dir plugins/sirius-research
```

The plugin connects to the `sirius-corpus` MCP server. For local development, run the corpus server first:

```sh
bun --cwd apps/mcp dev
```

Then provide a Lesswhelmed API key through the environment:

```sh
export SIRIUS_MCP_API_KEY=<plaintext-key>
```

The key is owner-scoped and should never be committed to the repository. The production endpoint can be used by changing the endpoint in `.mcp.json` to `https://mcp.lesswhelmed.com/mcp`.

After loading the plugin, use `/mcp` in Claude Code to confirm that the server and its tools are available. The detailed command list and configuration remain in the main [plugin README](./README.md).

## A few useful prompts

```text
What have I written about making difficult work feel lighter?
```

```text
Research my posts on attention. Compare the recurring themes and cite the source posts.
```

```text
Summarize the category path `work/attention` and tell me where the writing disagrees with itself.
```

```text
Answer only from my corpus: what practices do I recommend for recovering from overload?
```

For a quick answer, use `research-topic`. For a careful, wide-ranging synthesis, use `deep-corpus-research`. When accuracy and source boundaries matter most, use `cite-from-corpus`.

## A wholesome way to think about it

Sirius Research is best used as a conversation with your past self: curious, patient, and willing to notice both the repeated lessons and the unfinished questions. It can help you gather the threads. You still decide what they mean, what deserves more attention, and what you want to carry forward.
