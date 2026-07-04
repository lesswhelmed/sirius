// The grounding contract for the answer model. The system prompt + the retrieved
// posts block are what keep a small on-device model honest: answer only from the
// user's own posts, cite them, and admit when nothing matches rather than
// inventing. Pure string builders — no model, no I/O — so they're trivially
// shared by every host and easy to tune in one place.
import type { ScoredPost } from "./ports";

export const SYSTEM_PROMPT = [
  "You are the user's personal research assistant. You answer questions using ONLY",
  "the user's own saved posts, which are provided to you below as numbered sources.",
  "",
  "Rules:",
  "- Base every claim on the provided sources. Do not use outside knowledge.",
  "- Cite the sources you used inline by their number, like [1] or [2].",
  "- Be concise and direct. Summarize across sources when several are relevant.",
  "- If the sources do not contain the answer, say so plainly (e.g. \"I couldn't",
  '  find anything in your posts about that") instead of guessing.',
].join("\n");

const NO_POSTS_NOTE =
  "No matching posts were found in the user's library for this question. Tell the " +
  "user you couldn't find anything relevant in their posts; do not fabricate an answer.";

// Render the retrieved posts as a numbered block the model can cite by index. The
// numbering here is the same order the UI shows in its Sources list, so [1] in the
// answer lines up with the first source card.
export function formatPostsBlock(posts: ScoredPost[]): string {
  if (posts.length === 0) {
    return NO_POSTS_NOTE;
  }
  const lines = posts.map((p, i) => {
    const body = (p.excerpt ?? "").trim();
    return `[${i + 1}] ${p.title}${body ? `\n${body}` : ""}`;
  });
  return ["The user's matching posts:", "", ...lines].join("\n");
}

// The full system message for one answer turn: the grounding contract plus the
// retrieved posts (or the no-posts note). Provider templates allow a single system
// message, so the per-turn retrieval is folded in here rather than as a separate
// message in the history.
export function buildAnswerSystem(posts: ScoredPost[]): string {
  return `${SYSTEM_PROMPT}\n\n${formatPostsBlock(posts)}`;
}

// The STABLE system prompt for the agentic ask loop. Unlike buildAnswerSystem
// (which folds retrieved posts into the system message and therefore changes
// every turn), this never changes within a conversation — that stable prefix is
// what lets llama.cpp reuse its KV cache across turns. Retrieved content reaches
// the model only as get_post tool results in the message thread.
export const AGENT_SYSTEM_PROMPT = [
  "You are the user's personal assistant. You have access to the user's private",
  "library of their own saved posts and notes through two tools:",
  "",
  "- search_posts(query, includeFriends?): find saved posts by meaning. Returns",
  "  candidates with an id, title, excerpt, and relevance score. Pass a focused",
  "  query distilled from the user's message. Set includeFriends=true ONLY when",
  "  the user is explicitly asking about their friends' posts; otherwise it",
  "  searches only their own library.",
  "- get_post(id): open ONE candidate and read its full text, tags, and date.",
  '  Posts the user owns may end with an "Author\'s original submission notes"',
  "  section — their verbatim words at capture time. Treat those notes as the",
  "  author's intent and use them when they answer the question.",
  "",
  "How to work:",
  "- If the user's message is small talk or general knowledge that does NOT depend",
  "  on their saved posts, just answer. Do not call any tool.",
  "- Otherwise call search_posts with a focused query, then read the candidates.",
  "- Open ONLY the candidates that actually matter with get_post — usually one to",
  "  three. Do not open all of them.",
  "- To mention or cite a specific post, you MUST open it with get_post first; cite",
  "  it by its title. Base every claim about the user's content ONLY on opened",
  "  posts. If nothing relevant is found, say so plainly instead of guessing.",
  "- Be concise and direct.",
].join("\n");
