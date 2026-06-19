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
