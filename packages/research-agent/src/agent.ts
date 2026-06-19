// The full research turn, for hosts that can hold an embedding model and a
// language model resident at the same time (e.g. a web WebLLM client). The mobile
// app does NOT use this — it can keep only one llama context loaded, so it
// orchestrates the two phases itself (see apps/mobile/.../research) using
// searchPosts + streamResearchAnswer directly. The logic is identical; only the
// model-residency orchestration differs, which is inherently per-platform.
//
// Two modes:
//   "primed"       — deterministically run the search first, then stream a grounded
//                    answer. Robust on small models that may "forget" to call a
//                    tool. This is the recommended default.
//   "native-tools" — register the search tool and let the model decide when to call
//                    it, looping via stopWhen. Requires reliable on-model tool
//                    calling and concurrent model residency.
import { type ModelMessage, stepCountIs, streamText, tool } from "ai";
import { type ResearchStream, streamResearchAnswer } from "./answer";
import type { ResearchPorts, ScoredPost } from "./ports";
import { buildAnswerSystem, SYSTEM_PROMPT } from "./prompt";
import { PostSearchInputSchema } from "./schema";
import { type SearchOptions, searchPosts } from "./search";
import { POST_SEARCH_TOOL_NAME } from "./tool";

export type ResearchMode = "primed" | "native-tools";

export interface RunResearchArgs {
	ports: ResearchPorts;
	messages: ModelMessage[];
	mode?: ResearchMode;
	search?: Pick<SearchOptions, "topK" | "minScore">;
	abortSignal?: AbortSignal;
}

export interface ResearchRun {
	// The streamText result; consume `.textStream` for the answer tokens.
	stream: ResearchStream;
	// The posts cited by this run, for the Sources UI. In "primed" mode it is the
	// full retrieved set (available immediately); in "native-tools" mode it fills as
	// the model invokes the tool, so read it after the stream finishes.
	citations: ScoredPost[];
}

function lastUserText(messages: ModelMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role !== "user") continue;
		if (typeof m.content === "string") return m.content;
		// Multi-part user content: concatenate the text parts.
		return m.content
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join(" ");
	}
	return "";
}

export async function runResearchAgent(
	args: RunResearchArgs,
): Promise<ResearchRun> {
	const { ports, messages, abortSignal } = args;
	const mode = args.mode ?? "primed";

	if (mode === "primed") {
		const posts = await searchPosts(ports, lastUserText(messages), {
			...args.search,
			abortSignal,
		});
		return {
			stream: streamResearchAnswer({
				llm: ports.llm,
				messages,
				posts,
				abortSignal,
			}),
			citations: posts,
		};
	}

	// native-tools: capture cited posts as the model calls the tool.
	const citations: ScoredPost[] = [];
	const searchTool = tool({
		description:
			"Search the user's own saved posts by meaning and return the most relevant.",
		inputSchema: PostSearchInputSchema,
		execute: async ({ query, topK }) => {
			const posts = await searchPosts(ports, query, {
				topK: topK ?? args.search?.topK,
				minScore: args.search?.minScore,
				abortSignal,
			});
			citations.push(...posts);
			return { posts };
		},
	});

	const stream = streamText({
		model: ports.llm,
		system: SYSTEM_PROMPT,
		messages,
		tools: { [POST_SEARCH_TOOL_NAME]: searchTool },
		stopWhen: stepCountIs(4),
		temperature: 0.4,
		abortSignal,
	}) as unknown as ResearchStream;

	return { stream, citations };
}

// Re-export so a host can build the no-posts/grounded system prompt without
// reaching into prompt.ts directly.
export { buildAnswerSystem };
