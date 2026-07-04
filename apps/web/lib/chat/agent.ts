// The server chat agent: Gemini Flash driving the @repo/research-agent tool loop,
// with its two tools backed by in-process @repo/db calls. Owner-scoped to the
// viewer; get_post can only open posts that search_posts already surfaced to
// this viewer (the per-request candidateBySlug map is the visibility gate — a
// candidate is only in it because searchCorpus cleared it).
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  findPostBySlug,
  listSourceSubmissionsForPost,
  requireApiKey,
  searchCorpus,
  type IngestSubmission,
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

import { rawNotesFor } from "../originals/original-content";
import type { ChatSource } from "./ui-stream";

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

// The verbatim text the owner typed at capture, as a clearly-labeled trailer
// for get_post results. OWNER-ONLY: callers must gate on
// post.submittedById === viewerId before appending — friends' shared posts
// must never expose their submission notes to another viewer's chat.
export function ownerNotesBlock(
  submissions: Array<Pick<IngestSubmission, "payload">>,
): string {
  const notes = submissions
    .map((s) => rawNotesFor(s.payload).notes)
    .filter((n) => n.length > 0);
  if (notes.length === 0) {
    return "";
  }
  return [
    "",
    "---",
    "Author's original submission notes (verbatim):",
    ...notes,
  ].join("\n");
}

export function buildChatDeps(
  viewerId: string,
  onPostOpened?: (post: ChatSource) => void,
): { deps: AskAgentDeps } {
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
    onPostOpened?.({
      serverId: post.slug,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
    });
    const full = postToFullPost(post);
    // Owner-only: append the author's original capture notes so the agent can
    // ground on what the user actually said, not just the generated post.
    // Never for peers' posts — their notes are private (see ownerNotesBlock).
    if (post.submittedById === viewerId) {
      const block = ownerNotesBlock(
        await listSourceSubmissionsForPost(post.id),
      );
      if (block) {
        full.body += `\n${block}`;
      }
    }
    return full;
  };

  return { deps: { llm: google(CHAT_MODEL_ID), search, getPost } };
}

export function runChatTurn(args: {
  viewerId: string;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
  onPostOpened?: (post: ChatSource) => void;
}): AskAgentRun {
  const { deps } = buildChatDeps(args.viewerId, args.onPostOpened);
  return runAskAgent({
    deps,
    messages: args.messages,
    abortSignal: args.abortSignal,
  });
}
