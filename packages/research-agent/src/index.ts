// @repo/research-agent — host-agnostic core for an on-device "ask my posts"
// assistant. Embed a query on-device, rank the user's local post-vector index by
// cosine similarity, and stream a grounded answer that cites the matching posts.
//
// Platform-specific pieces (the embedding model, the language model, the vector
// store) are injected via the ports in ./ports. The mobile app composes the two
// phases itself (single resident model); a future web WebLLM client can use
// runResearchAgent directly (concurrent models). Nothing here imports a runtime.

export {
	type ResearchMode,
	type ResearchRun,
	type RunResearchArgs,
	runResearchAgent,
} from "./agent";
export {
	type ResearchStream,
	type StreamAnswerArgs,
	streamResearchAnswer,
} from "./answer";
export { cosineSim } from "./cosine";
export { contentHash } from "./hash";
export type {
	PostRef,
	PostVectorStore,
	ResearchPorts,
	ScoredPost,
	SearchPorts,
	StoredVector,
	VectorUpsert,
} from "./ports";
export {
	buildAnswerSystem,
	formatPostsBlock,
	SYSTEM_PROMPT,
} from "./prompt";
export {
	type PostSearchInput,
	PostSearchInputSchema,
	type PostSearchOutput,
	PostSearchOutputSchema,
	ScoredPostSchema,
} from "./schema";
export { type SearchOptions, searchPosts } from "./search";
export { createPostSearchTool, POST_SEARCH_TOOL_NAME } from "./tool";
