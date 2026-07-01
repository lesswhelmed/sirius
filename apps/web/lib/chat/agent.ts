// The server chat agent: Gemini Flash driving the @repo/research-agent tool loop,
// with its two tools backed by in-process @repo/db calls. Owner-scoped to the
// viewer; get_post can only open posts that search_posts already surfaced to
// this viewer (the per-request candidateBySlug map is the visibility gate — a
// candidate is only in it because searchCorpus cleared it).
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  findPostBySlug,
  requireApiKey,
  searchCorpus,
  type PostWithRelations,
  type SearchHit,
} from "@repo/db";
import {
  runAskAgent,
  type AskAgentDeps,
  type AskAgentRun,
  type Candidate,
  type FullPost,
} from "@repo/research-agent";
import type { ModelMessage } from "ai";

const CHAT_MODEL_ID = "gemini-3.5-flash";
// Enough candidates for the model to choose from without bloating the tool result.
const SEARCH_LIMIT = 8;

export function hitToCandidate(hit: SearchHit): Candidate {
  return {
    id: hit.slug,
    title: hit.title,
    excerpt: hit.snippet ?? hit.excerpt,
    score: hit.score,
  };
}

export function postToFullPost(post: PostWithRelations): FullPost {
  return {
    id: post.slug,
    slug: post.slug,
    title: post.title,
    body: post.content,
    excerpt: post.excerpt,
    tags: post.tags.map((t) => t.name),
    categories: post.categories.map((c) => c.name),
    createdAt: post.createdAt ? post.createdAt.toISOString() : null,
  };
}

export function buildChatDeps(viewerId: string): { deps: AskAgentDeps } {
  const google = createGoogleGenerativeAI({ apiKey: requireApiKey() });
  // A candidate is added here only after searchCorpus cleared it for this viewer;
  // get_post refuses any slug not in this set, so the model cannot open a post the
  // viewer can't see (or one it hallucinated).
  const candidateBySlug = new Map<string, true>();

  const search: AskAgentDeps["search"] = async (query, opts) => {
    const page = await searchCorpus(viewerId, query, {
      scope: opts?.includeFriends ? "all" : "mine",
      limit: SEARCH_LIMIT,
      // publicCatalogEnabled intentionally omitted → stays false → no strangers.
    });
    for (const hit of page.items) candidateBySlug.set(hit.slug, true);
    return page.items.map(hitToCandidate);
  };

  const getPost: AskAgentDeps["getPost"] = async (id) => {
    if (!candidateBySlug.has(id)) return null; // not surfaced to this viewer
    const post = await findPostBySlug(id);
    if (!post) return null;
    return postToFullPost(post);
  };

  return { deps: { llm: google(CHAT_MODEL_ID), search, getPost } };
}

export function runChatTurn(args: {
  viewerId: string;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
}): AskAgentRun {
  const { deps } = buildChatDeps(args.viewerId);
  return runAskAgent({
    deps,
    messages: args.messages,
    abortSignal: args.abortSignal,
  });
}
